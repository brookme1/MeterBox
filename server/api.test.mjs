import test from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import nacl from "tweetnacl";
import { PROGRAM_ID, buildVoucherMessage, deriveChannelPda } from "../shared/voucher.mjs";

process.env.PROVIDER_ADMIN_TOKEN = "test-admin-token";
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
