import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, Ed25519Program } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { createHash } from "node:crypto";
import {
  ENDPOINTS,
  PROGRAM_ID,
  buildVoucherMessage,
  deriveChannelPda,
} from "../shared/voucher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const mode = process.env.SOLANA_MODE || "demo";
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const adminToken = process.env.PROVIDER_ADMIN_TOKEN || "";
const dataFile = process.env.METERBOX_DATA_FILE || path.join(__dirname, "../data/state.json");
const connection = new Connection(rpcUrl, "confirmed");

function anchorDiscriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

app.use(cors({ origin: clientOrigin === "*" ? true : clientOrigin }));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return { channels: {} };
  }
}

let state = loadState();
const eventClients = new Set();

function saveState() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
  const event = JSON.stringify({ at: new Date().toISOString(), channels: state.channels });
  for (const res of eventClients) res.write(`data: ${event}\n\n`);
}

function channelState(id) {
  return state.channels[id];
}

function requireAdmin(req, res, next) {
  if (!adminToken || req.get("x-meterbox-admin-token") === adminToken) return next();
  return res.status(401).json({ error: "provider admin token required" });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "meterbox", mode, programId: PROGRAM_ID });
});

app.post("/api/channels", async (req, res) => {
  const { channelPda, agentPublicKey, payer, payee, channelId, deposit, spendingLimit } = req.body || {};
  if (!channelPda || !agentPublicKey || !payer || !payee || !Number.isSafeInteger(Number(channelId))) {
    return res.status(400).json({ error: "channelPda, agentPublicKey, payer, payee, and channelId are required" });
  }
  try {
    for (const value of [channelPda, agentPublicKey, payer, payee]) {
      if (value === agentPublicKey) continue;
      new PublicKey(value);
    }
  } catch {
    return res.status(400).json({ error: "invalid public key" });
  }
  let agentBytes;
  try {
    agentBytes = Buffer.from(agentPublicKey, "base64");
  } catch {
    return res.status(400).json({ error: "bad agentPublicKey" });
  }
  if (agentBytes.length !== 32) return res.status(400).json({ error: "agent public key must be 32 bytes" });
  const expectedPda = deriveChannelPda(payer, payee, Number(channelId), PROGRAM_ID);
  if (channelPda !== expectedPda) return res.status(400).json({ error: "channelPda does not match the channel seeds" });
  if (mode === "devnet") {
    try {
      const account = await connection.getAccountInfo(new PublicKey(channelPda), "confirmed");
      if (!account) return res.status(400).json({ error: "channel account does not exist on devnet" });
      const data = account.data;
      const decodedPayer = new PublicKey(data.subarray(8, 40));
      const decodedPayee = new PublicKey(data.subarray(40, 72));
      const decodedAgent = new PublicKey(data.subarray(72, 104));
      const decodedId = Number(data.readBigUInt64LE(104));
      const decodedDeposit = data.readBigUInt64LE(112).toString();
      const decodedLimit = data.readBigUInt64LE(120).toString();
      if (!decodedPayer.equals(new PublicKey(payer))) return res.status(400).json({ error: "on-chain payer mismatch" });
      if (!decodedPayee.equals(new PublicKey(payee))) return res.status(400).json({ error: "on-chain payee mismatch" });
      if (!decodedAgent.equals(new PublicKey(Buffer.from(agentBytes)))) return res.status(400).json({ error: "on-chain agent mismatch" });
      if (decodedId !== Number(channelId)) return res.status(400).json({ error: "on-chain channelId mismatch" });
      if (deposit != null && decodedDeposit !== String(deposit)) return res.status(400).json({ error: "on-chain deposit mismatch" });
      if (spendingLimit != null && decodedLimit !== String(spendingLimit)) return res.status(400).json({ error: "on-chain spending limit mismatch" });
      Object.assign(req, { decodedOnChain: true });
    } catch (error) {
      return res.status(400).json({ error: `channel verification failed: ${error.message}` });
    }
  }
  state.channels[channelPda] = {
    channelPda,
    agentPublicKey,
    payer,
    payee,
    channelId: String(channelId),
    deposit: String(deposit || 0),
    spendingLimit: String(spendingLimit || 0),
    lastNonce: "0",
    lastCumulative: "0",
    settled: "0",
    calls: [],
    settlements: [],
  };
  saveState();
  res.json({ channel: channelPda, payee, programId: PROGRAM_ID, agentPublicKey });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  eventClients.add(res);
  req.on("close", () => eventClients.delete(res));
  res.write(`data: ${JSON.stringify({ at: new Date().toISOString(), channels: state.channels })}\n\n`);
});

app.get("/api/state", (req, res) => {
  const id = req.query.channel;
  if (id) {
    const channel = channelState(String(id));
    if (!channel) return res.status(404).json({ error: "channel not found" });
    const settled = BigInt(channel.settled);
    return res.json({
      ...channel,
      calls: channel.calls.slice(-50),
      unsettled: (BigInt(channel.lastCumulative) - settled).toString(),
    });
  }
  res.json({ channels: state.channels });
});

function paywall(id, resource, price) {
  const channel = channelState(id);
  if (!channel) return null;
  return {
    scheme: "meterbox",
    network: "solana-devnet",
    programId: PROGRAM_ID,
    payee: channel.payee,
    channel: id,
    priceLamports: String(price),
    resource,
    lastAcceptedCumulative: channel.lastCumulative,
    lastAcceptedNonce: channel.lastNonce,
  };
}

function checkVoucher(req, price) {
  const header = req.get("x-meterbox-voucher");
  if (!header) return { ok: false, status: 402 };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "malformed voucher" };
  }
  const id = payload.channel;
  const channel = channelState(id);
  if (!channel) return { ok: false, status: 404, error: "channel not registered" };
  let cumulative;
  let nonce;
  let signature;
  try {
    cumulative = BigInt(payload.cumulativeAmount);
    nonce = BigInt(payload.nonce);
    signature = Buffer.from(payload.signature, "base64");
  } catch {
    return { ok: false, status: 400, error: "bad voucher fields" };
  }
  if (nonce <= BigInt(channel.lastNonce)) return { ok: false, status: 409, error: "nonce too low" };
  if (nonce !== BigInt(channel.lastNonce) + 1n) return { ok: false, status: 409, error: "nonce must increase by one" };
  if (cumulative < BigInt(channel.lastCumulative) + BigInt(price)) {
    return { ok: false, status: 402, error: "insufficient cumulative amount" };
  }
  if (cumulative > BigInt(channel.spendingLimit)) return { ok: false, status: 402, error: "spending limit exceeded" };
  const message = buildVoucherMessage({
    programId: PROGRAM_ID,
    channel: id,
    payee: channel.payee,
    cumulative,
    nonce,
  });
  const agent = Buffer.from(channel.agentPublicKey, "base64");
  if (!nacl.sign.detached.verify(message, signature, agent)) {
    return {
      ok: false,
      status: 401,
      error: "invalid signature",
    };
  }
  channel.lastNonce = nonce.toString();
  channel.lastCumulative = cumulative.toString();
  channel.latestSignature = signature.toString("base64");
  return { ok: true, cumulative, nonce, channel };
}

for (const ep of ENDPOINTS) {
  app.all(ep.path, (req, res) => {
    const header = req.get("x-meterbox-voucher");
    let id = req.get("x-meterbox-channel");
    if (!id && header) {
      try {
        id = JSON.parse(Buffer.from(header, "base64").toString("utf8")).channel;
      } catch {}
    }
    if (!id) {
      const ids = Object.keys(state.channels);
      id = ids[ids.length - 1];
    }
    if (!channelState(id)) return res.status(404).json({ error: "channel not registered" });
    const result = checkVoucher(req, ep.price);
    if (!result.ok) {
      if (result.status === 402) {
        const body = paywall(id, ep.path, ep.price);
        return res.status(402).set("WWW-Authenticate", "MeterBox").json({
          ...body,
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return res.status(result.status).json({ error: result.error });
    }
    const call = {
      name: ep.name,
      price: String(ep.price),
      nonce: result.nonce.toString(),
      cumulative: result.cumulative.toString(),
      status: 200,
      at: new Date().toISOString(),
    };
    result.channel.calls.push(call);
    saveState();
    res.set("X-METERBOX-RECEIPT", JSON.stringify({ paid: String(ep.price), nonce: call.nonce, resource: ep.name }));
    const bodies = {
      weather: { city: req.query.city || "Berlin", tempC: 14, condition: "Partly cloudy", source: "meterbox" },
      sentiment: { sentiment: "positive", score: 0.62, source: "meterbox" },
      price: { symbol: req.query.symbol || "SOL", priceUsd: 178.4, source: "meterbox" },
      search: { query: req.query.q || "", results: [{ title: "Solana payment channels" }], source: "meterbox" },
      image: { imageUrl: "https://placehold.co/512x512/141725/14F195?text=MeterBox", source: "meterbox" },
    };
    res.json(bodies[ep.name]);
  });
}

app.post("/api/channels/:id/settle", requireAdmin, async (req, res) => {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  const cumulative = BigInt(channel.lastCumulative);
  const settled = BigInt(channel.settled);
  if (cumulative <= settled) return res.status(400).json({ error: "nothing to settle" });
  const delta = cumulative - settled;
  if (mode === "demo") {
    channel.settled = cumulative.toString();
    const settlement = { delta: delta.toString(), cumulative: cumulative.toString(), at: new Date().toISOString(), mode: "demo", note: "No on-chain transaction in demo mode" };
    channel.settlements.push(settlement);
    saveState();
    return res.json(settlement);
  }
  if (!process.env.PROVIDER_KEYPAIR_PATH && !process.env.PROVIDER_KEYPAIR_BASE58) {
    return res.status(503).json({ error: "provider keypair is not configured" });
  }
  try {
    let providerKeypair;
    if (process.env.PROVIDER_KEYPAIR_PATH) {
      providerKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.PROVIDER_KEYPAIR_PATH, "utf8"))));
    } else if (process.env.PROVIDER_KEYPAIR_BASE58) {
      const { default: bs58 } = await import("bs58");
      providerKeypair = Keypair.fromSecretKey(bs58.decode(process.env.PROVIDER_KEYPAIR_BASE58));
    } else {
      providerKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME || "", ".config/solana/id.json"), "utf8"))));
    }
    if (!providerKeypair.publicKey.equals(new PublicKey(channel.payee))) {
      return res.status(403).json({ error: "provider keypair does not match the channel payee" });
    }
    if (!channel.latestSignature) {
      return res.status(400).json({ error: "no signed voucher is available" });
    }
    const cumulativeBn = new BN(channel.lastCumulative);
    const nonceBn = new BN(channel.lastNonce);
    const message = buildVoucherMessage({
      programId: PROGRAM_ID,
      channel: req.params.id,
      payee: channel.payee,
      cumulative: cumulative.toString(),
      nonce: channel.lastNonce,
    });
    const signature = Buffer.from(channel.latestSignature, "base64");
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: Buffer.from(channel.agentPublicKey, "base64"),
      message,
      signature,
    });
    const settleData = Buffer.concat([
      anchorDiscriminator("settle"),
      Buffer.from(cumulativeBn.toArrayLike(Buffer, "le", 8)),
      Buffer.from(nonceBn.toArrayLike(Buffer, "le", 8)),
    ]);
    const settleInstruction = new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: providerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(req.params.id), isSigner: false, isWritable: true },
        { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
        { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      ],
      data: settleData,
    });
    const tx = new Transaction().add(ed25519Instruction).add(settleInstruction);
    tx.feePayer = providerKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(providerKeypair);
    const signatureHex = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signatureHex, "confirmed");
    channel.settled = cumulative.toString();
    const settlement = {
      delta: delta.toString(),
      cumulative: cumulative.toString(),
      at: new Date().toISOString(),
      mode: "devnet",
      signature: signatureHex,
      explorerUrl: `https://explorer.solana.com/tx/${signatureHex}?cluster=devnet`,
    };
    channel.settlements.push(settlement);
    saveState();
    return res.json(settlement);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/channels/:id/close", requireAdmin, async (req, res) => {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  if (mode === "demo") return res.json({ mode: "demo", note: "Channel state closed in demo mode" });
  try {
    const providerKeypair = Keypair.fromSecretKey(
      Uint8Array.from(
        JSON.parse(fs.readFileSync(
          process.env.PROVIDER_KEYPAIR_PATH || path.join(process.env.HOME || "", ".config/solana/id.json"),
          "utf8",
        )),
      ),
    );
    if (!providerKeypair.publicKey.equals(new PublicKey(channel.payee))) {
      return res.status(403).json({ error: "provider keypair does not match the channel payee" });
    }
    const instruction = new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: providerKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: providerKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: providerKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(req.params.id), isSigner: false, isWritable: true },
      ],
      data: anchorDiscriminator("close_channel"),
    });
    const tx = new Transaction().add(instruction);
    tx.feePayer = providerKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(providerKeypair);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, "confirmed");
    return res.json({
      mode: "devnet",
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/demo/reset", requireAdmin, (_req, res) => {
  state = { channels: {} };
  saveState();
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, "0.0.0.0", () => {
    console.log(`MeterBox API on :${port} (${mode.toUpperCase()} MODE)`);
  });
}
