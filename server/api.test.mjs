import test from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, buildVoucherMessage, deriveChannelPda } from "../shared/voucher.mjs";

process.env.PROVIDER_ADMIN_TOKEN = "test-admin-token";
process.env.METERBOX_DB_PATH = ":memory:";
const { app } = await import("./index.mjs");
const request = supertest(app);
const payer = "11111111111111111111111111111111";
const payee = "11111111111111111111111111111112";
const channel = deriveChannelPda(payer, payee, 41, PROGRAM_ID);
const keys = nacl.sign.keyPair();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

async function register() {
  await request.post("/api/channels").send({
    channelPda: channel,
    agentPublicKey: b64(keys.publicKey),
    payer,
    payee,
    channelId: 41,
    deposit: "100000000",
    spendingLimit: "1750000",
  });
}

test("402 without voucher", async () => {
  await register();
  const res = await request.get("/api/paid/weather").set("x-meterbox-channel", channel);
  assert.equal(res.status, 402);
  assert.equal(res.body.lastAcceptedNonce, "0");
});

test("API config exposes public devnet settings only", async () => {
  const res = await request.get("/api/config");
  assert.equal(res.status, 200);
  assert.equal(res.body.mode, "demo");
  assert.equal(res.body.providerPublicKey, null);
  assert.equal(res.body.endpoints.length, 5);
});

test("200 with valid voucher", async () => {
  await register();
  const cumulative = 100_000;
  const nonce = 1;
  const message = buildVoucherMessage({ programId: PROGRAM_ID, channel, payee, cumulative, nonce });
  const signature = nacl.sign.detached(message, keys.secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({ channel, cumulativeAmount: String(cumulative), nonce: String(nonce), signature: b64(signature) })));
  const res = await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  assert.equal(res.status, 200);
});

test("409 replay", async () => {
  await register();
  const cumulative = 100_000;
  const nonce = 1;
  const message = buildVoucherMessage({ programId: PROGRAM_ID, channel, payee, cumulative, nonce });
  const signature = nacl.sign.detached(message, keys.secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({ channel, cumulativeAmount: String(cumulative), nonce: String(nonce), signature: b64(signature) })));
  await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  const replay = await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  assert.equal(replay.status, 409);
});

test("401 forged signature", async () => {
  await register();
  const message = buildVoucherMessage({ programId: PROGRAM_ID, channel, payee, cumulative: 100_000, nonce: 1 });
  const forged = nacl.sign.detached(message, nacl.sign.keyPair().secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({ channel, cumulativeAmount: "100000", nonce: "1", signature: b64(forged) })));
  const res = await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "invalid signature");
});

test("401 tampered voucher", async () => {
  await register();
  const message = buildVoucherMessage({ programId: PROGRAM_ID, channel, payee, cumulative: 100_000, nonce: 1 });
  const signature = nacl.sign.detached(message, keys.secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({ channel, cumulativeAmount: "150000", nonce: "1", signature: b64(signature) })));
  const res = await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "invalid signature");
});

test("402 voucher over spending limit", async () => {
  await register();
  const cumulative = 1_800_000;
  const message = buildVoucherMessage({ programId: PROGRAM_ID, channel, payee, cumulative, nonce: 1 });
  const signature = nacl.sign.detached(message, keys.secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({ channel, cumulativeAmount: String(cumulative), nonce: "1", signature: b64(signature) })));
  const res = await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher);
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "spending limit exceeded");
});

test("settle needs admin token", async () => {
  await register();
  const res = await request.post(`/api/channels/${channel}/settle`);
  assert.equal(res.status, 401);
});

test("public settlement requires payer approval", async () => {
  const payerKeys = nacl.sign.keyPair();
  const payerAddress = new PublicKey(payerKeys.publicKey).toBase58();
  const channelId = 42;
  const approvedChannel = deriveChannelPda(payerAddress, payee, channelId, PROGRAM_ID);
  const registered = await request.post("/api/channels").send({
    channelPda: approvedChannel,
    agentPublicKey: b64(keys.publicKey),
    payer: payerAddress,
    payee,
    channelId,
    deposit: "100000000",
    spendingLimit: "1750000",
  });
  assert.equal(registered.status, 200);
  const voucherMessage = buildVoucherMessage({
    programId: PROGRAM_ID,
    channel: approvedChannel,
    payee,
    cumulative: 100_000,
    nonce: 1,
  });
  const voucherSignature = nacl.sign.detached(voucherMessage, keys.secretKey);
  const voucher = b64(Buffer.from(JSON.stringify({
    channel: approvedChannel,
    cumulativeAmount: "100000",
    nonce: "1",
    signature: b64(voucherSignature),
  })));
  assert.equal((await request.get("/api/paid/weather").set("x-meterbox-voucher", voucher)).status, 200);
  const settleMessage = new TextEncoder().encode(
    `METERBOX_SETTLE_REQUEST_V1:${approvedChannel}:1:100000`,
  );
  const payerSignature = b64(nacl.sign.detached(settleMessage, payerKeys.secretKey));
  const settlement = await request.post(`/api/public/channels/${approvedChannel}/settle`).send({
    publicKey: payerAddress,
    signature: payerSignature,
  });
  assert.equal(settlement.status, 200);
  assert.equal(settlement.body.mode, "demo");
  assert.equal(settlement.body.signature, undefined);
});
