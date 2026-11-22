import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, Ed25519Program } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
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
    return { ok: false, status: 401, error: "invalid signature" };
  }
  channel.lastNonce = nonce.toString();
  channel.lastCumulative = cumulative.toString();
  channel.latestSignature = signature.toString("base64");
  return { ok: true, cumulative, nonce, channel };
}

for (const ep of ENDPOINTS) {
  app.all(ep.path, (req, res) => {
    const header = req.get("x-meterbox-voucher");
    let id;
    if (header) {
      try {
        id = JSON.parse(Buffer.from(header, "base64").toString("utf8")).channel;
      } catch {}
    }
    if (!id) {
      id = Object.keys(state.channels)[0];
    }
    const result = checkVoucher(req, ep.price);
    if (!result.ok) {
      if (result.status === 402) {
        const body = paywall(id, ep.path, ep.price);
        return res.status(402).set("WWW-Authenticate", "MeterBox").json(body);
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
    let provider;
    if (process.env.PROVIDER_KEYPAIR_PATH) {
      provider = anchor.AnchorProvider.env?.();
    }
    return res.status(501).json({ error: "devnet settlement requires an installed Anchor IDL and deployed program" });
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
