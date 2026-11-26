import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, Ed25519Program } from "@solana/web3.js";
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
const clientOrigins = clientOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
const adminToken = process.env.PROVIDER_ADMIN_TOKEN || "";
const dataFile = process.env.METERBOX_DATA_FILE || path.join(__dirname, "../data/state.json");
const databaseFile = process.env.METERBOX_DB_PATH || path.join(__dirname, "../data/meterbox.sqlite");
const connection = new Connection(rpcUrl, "confirmed");
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
const database = new Database(databaseFile);
database.exec("CREATE TABLE IF NOT EXISTS channels (channel_pda TEXT PRIMARY KEY, payload TEXT NOT NULL)");
database.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

function anchorDiscriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function normalizeChannel(channel) {
  if (!channel.agent && channel.agentPublicKey) {
    const bytes = Buffer.from(channel.agentPublicKey, "base64");
    if (bytes.length !== 32) throw new Error(`invalid stored agent key for channel ${channel.channelPda}`);
    channel.agent = new PublicKey(bytes).toBase58();
  }
  return channel;
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.includes("*") || clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("origin is not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

function loadState() {
  const rows = database.prepare("SELECT channel_pda, payload FROM channels").all();
  if (rows.length) return { channels: Object.fromEntries(rows.map((row) => [row.channel_pda, normalizeChannel(JSON.parse(row.payload))])) };
  if (!fs.existsSync(dataFile)) return { channels: {} };
  const legacy = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const insert = database.prepare("INSERT OR REPLACE INTO channels (channel_pda, payload) VALUES (?, ?)");
  database.transaction(() => {
    for (const [id, channel] of Object.entries(legacy.channels || {})) {
      const normalized = normalizeChannel(channel);
      insert.run(id, JSON.stringify(normalized));
      legacy.channels[id] = normalized;
    }
  })();
  return legacy;
}

let state = loadState();
const storedPricing = database.prepare("SELECT value FROM settings WHERE key = 'endpoint_pricing'").get();
let endpointPricing = storedPricing
  ? JSON.parse(storedPricing.value)
  : Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint.name, endpoint.price]));
const eventClients = new Set();

function saveState() {
  const replace = database.prepare("INSERT OR REPLACE INTO channels (channel_pda, payload) VALUES (?, ?)");
  const remove = database.prepare("DELETE FROM channels");
  database.transaction(() => {
    remove.run();
    for (const [id, channel] of Object.entries(state.channels)) replace.run(id, JSON.stringify(channel));
  })();
  const event = JSON.stringify({ at: new Date().toISOString(), channels: state.channels });
  for (const res of eventClients) res.write(`data: ${event}\n\n`);
}

async function loadProviderKeypair() {
  let secret;
  if (process.env.PROVIDER_KEYPAIR_BASE58) {
    const { default: bs58 } = await import("bs58");
    secret = bs58.decode(process.env.PROVIDER_KEYPAIR_BASE58);
  } else {
    const keyPath = process.env.PROVIDER_KEYPAIR_PATH || path.join(process.env.HOME || "", ".config/solana/id.json");
    if (!fs.existsSync(keyPath)) return null;
    secret = Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8")));
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function channelState(id) {
  return state.channels[id];
}

function requireAdmin(req, res, next) {
  if (!adminToken) return res.status(503).json({ error: "provider admin token is not configured" });
  if (req.get("x-meterbox-admin-token") === adminToken) return next();
  return res.status(401).json({ error: "provider admin token required" });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "meterbox", mode, programId: PROGRAM_ID });
});

app.get("/api/config", async (_req, res) => {
  try {
    const provider = mode === "devnet" ? await loadProviderKeypair() : null;
    res.json({
      ok: true,
      service: "meterbox",
      mode,
      programId: PROGRAM_ID,
      providerPublicKey: provider?.publicKey.toBase58() || null,
      endpoints: ENDPOINTS.map((endpoint) => ({
        name: endpoint.name,
        path: endpoint.path,
        priceLamports: String(endpointPricing[endpoint.name]),
        priceSol: (endpointPricing[endpoint.name] / 1_000_000_000).toFixed(9),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: `provider configuration failed: ${error.message}` });
  }
});

app.patch("/api/pricing", async (req, res) => {
  try {
    if (mode !== "devnet") return res.status(409).json({ error: "endpoint pricing changes are available only in devnet mode" });
    const provider = await loadProviderKeypair();
    if (!provider) return res.status(503).json({ error: "provider wallet is not configured" });
    const { prices, signature, publicKey } = req.body || {};
    if (!prices || typeof prices !== "object" || !signature || !publicKey) {
      return res.status(400).json({ error: "prices, signature, and publicKey are required" });
    }
    if (!provider.publicKey.equals(new PublicKey(publicKey))) {
      return res.status(403).json({ error: "connect the configured provider wallet to change prices" });
    }
    const canonicalPrices = {};
    for (const endpoint of ENDPOINTS) {
      const amount = String(prices[endpoint.name] ?? "");
      if (!/^[1-9]\d{0,14}$/.test(amount)) return res.status(400).json({ error: `invalid lamport price for ${endpoint.name}` });
      canonicalPrices[endpoint.name] = amount;
    }
    if (Object.keys(prices).length !== ENDPOINTS.length) return res.status(400).json({ error: "exactly five endpoint prices are required" });
    const message = new TextEncoder().encode(`METERBOX_PRICING_V1:${JSON.stringify(canonicalPrices)}`);
    const signed = Buffer.from(signature, "base64");
    if (signed.length !== 64 || !nacl.sign.detached.verify(message, signed, provider.publicKey.toBytes())) {
      return res.status(401).json({ error: "invalid provider wallet signature" });
    }
    database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('endpoint_pricing', ?)").run(JSON.stringify(canonicalPrices));
    endpointPricing = canonicalPrices;
    return res.json({
      ok: true,
      endpoints: ENDPOINTS.map((endpoint) => ({
        name: endpoint.name,
        path: endpoint.path,
        priceLamports: endpointPricing[endpoint.name],
        priceSol: (Number(endpointPricing[endpoint.name]) / 1e9).toFixed(9),
      })),
    });
  } catch (error) {
    return res.status(400).json({ error: `pricing update failed: ${error.message}` });
  }
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
  let decodedNonce = "0";
  let decodedSettled = "0";
  let decodedExpiry = "0";
  let decodedAgent = new PublicKey(Buffer.from(agentBytes));
  if (mode === "devnet") {
    try {
      const account = await connection.getAccountInfo(new PublicKey(channelPda), "confirmed");
      if (!account) return res.status(400).json({ error: "channel account does not exist on devnet" });
      if (!account.owner.equals(new PublicKey(PROGRAM_ID))) return res.status(400).json({ error: "channel is not owned by the MeterBox program" });
      const data = account.data;
      const decodedPayer = new PublicKey(data.subarray(8, 40));
      const decodedPayee = new PublicKey(data.subarray(40, 72));
      decodedAgent = new PublicKey(data.subarray(72, 104));
      const decodedId = Number(data.readBigUInt64LE(104));
      const decodedDeposit = data.readBigUInt64LE(112).toString();
      const decodedLimit = data.readBigUInt64LE(120).toString();
      decodedSettled = data.readBigUInt64LE(128).toString();
      decodedNonce = data.readBigUInt64LE(136).toString();
      decodedExpiry = data.readBigInt64LE(144).toString();
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
    agent: decodedAgent.toBase58(),
    payer,
    payee,
    channelId: String(channelId),
    deposit: String(deposit || 0),
    spendingLimit: String(spendingLimit || 0),
    lastNonce: decodedNonce || "0",
    lastCumulative: decodedSettled || "0",
    settled: decodedSettled || "0",
    expiresAt: decodedExpiry || "0",
    calls: state.channels[channelPda]?.calls || [],
    settlements: state.channels[channelPda]?.settlements || [],
  };
  state.channels[channelPda].policy = mode === "devnet" ? await decodeAgentPolicy(channelPda) : null;
  saveState();
  res.json({ channel: channelPda, payee, programId: PROGRAM_ID, agentPublicKey });
});

async function decodeChannelAccount(channelPda) {
  const account = await connection.getAccountInfo(new PublicKey(channelPda), "confirmed");
  if (!account) return null;
  if (!account.owner.equals(new PublicKey(PROGRAM_ID))) throw new Error("account is not owned by the MeterBox program");
  const data = account.data;
  if (data.length < 153) throw new Error("channel account data is truncated");
  return {
    channelPda,
    payer: new PublicKey(data.subarray(8, 40)).toBase58(),
    payee: new PublicKey(data.subarray(40, 72)).toBase58(),
    agent: new PublicKey(data.subarray(72, 104)).toBase58(),
    agentPublicKey: Buffer.from(data.subarray(72, 104)).toString("base64"),
    channelId: data.readBigUInt64LE(104).toString(),
    deposit: data.readBigUInt64LE(112).toString(),
    spendingLimit: data.readBigUInt64LE(120).toString(),
    settled: data.readBigUInt64LE(128).toString(),
    lastNonce: data.readBigUInt64LE(136).toString(),
    expiresAt: data.readBigInt64LE(144).toString(),
  };
}

async function decodeAgentPolicy(channelPda) {
  const [policyAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), new PublicKey(channelPda).toBuffer()],
    new PublicKey(PROGRAM_ID),
  );
  const account = await connection.getAccountInfo(policyAddress, "confirmed");
  if (!account) return null;
  if (!account.owner.equals(new PublicKey(PROGRAM_ID))) throw new Error("agent policy is not owned by the MeterBox program");
  if (account.data.length < 89) throw new Error("agent policy account data is truncated");
  return {
    maxPerRequest: account.data.readBigUInt64LE(72).toString(),
    dailyLimit: account.data.readBigUInt64LE(80).toString(),
  };
}

app.post("/api/channels/:id/sync", async (req, res) => {
  try {
    const channel = await decodeChannelAccount(req.params.id);
    if (!channel) return res.status(404).json({ error: "channel account is not open on devnet" });
    const existing = state.channels[req.params.id] || {};
    const policy = await decodeAgentPolicy(req.params.id);
    state.channels[req.params.id] = {
      ...existing,
      ...channel,
      policy,
      lastCumulative: existing.lastCumulative && BigInt(existing.lastCumulative) > BigInt(channel.settled)
        ? existing.lastCumulative
        : channel.settled,
      calls: existing.calls || [],
      settlements: existing.settlements || [],
    };
    saveState();
    return res.json(state.channels[req.params.id]);
  } catch (error) {
    return res.status(502).json({ error: `channel sync failed: ${error.message}` });
  }
});

app.post("/api/channels/:id/agent", async (req, res) => {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not registered" });
  const agentBytes = Buffer.from(String(req.body?.agentPublicKey || ""), "base64");
  if (agentBytes.length !== 32) return res.status(400).json({ error: "agent public key must be 32 bytes" });
  if (mode === "devnet") {
    try {
      const onChain = await decodeChannelAccount(req.params.id);
      if (!onChain) return res.status(404).json({ error: "channel account is not open on devnet" });
      if (!new PublicKey(onChain.agent).equals(new PublicKey(agentBytes))) {
        return res.status(409).json({ error: "agent key does not match the on-chain channel" });
      }
      channel.agent = onChain.agent;
    } catch (error) {
      return res.status(502).json({ error: `agent verification failed: ${error.message}` });
    }
  }
  channel.agentPublicKey = agentBytes.toString("base64");
  channel.agent = new PublicKey(agentBytes).toBase58();
  channel.lastNonce = channel.lastNonce || "0";
  delete channel.latestSignature;
  saveState();
  return res.json({ ok: true, channel: req.params.id, agent: channel.agent });
});

app.post("/api/channels/:id/closed", async (req, res) => {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not registered" });
  if (mode === "devnet") {
    try {
      if (await connection.getAccountInfo(new PublicKey(req.params.id), "confirmed")) {
        return res.status(409).json({ error: "channel is still open on devnet" });
      }
    } catch (error) {
      return res.status(502).json({ error: `close verification failed: ${error.message}` });
    }
  }
  channel.closed = true;
  saveState();
  return res.json({ ok: true, channel: req.params.id });
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
  if (channel.closed) return { ok: false, status: 410, error: "channel is closed" };
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
  if (channel.policy) {
    if (BigInt(price) > BigInt(channel.policy.maxPerRequest)) {
      return { ok: false, status: 402, error: "per-request policy limit exceeded" };
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const dailySpend = channel.calls
      .filter((call) => new Date(call.at).getTime() >= since)
      .reduce((sum, call) => sum + BigInt(call.price), 0n);
    if (dailySpend + BigInt(price) > BigInt(channel.policy.dailyLimit)) {
      return { ok: false, status: 402, error: "daily policy limit exceeded" };
    }
  }
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
    const price = endpointPricing[ep.name];
    const result = checkVoucher(req, price);
    if (!result.ok) {
      if (result.status === 402) {
        const body = paywall(id, ep.path, price);
        return res.status(402).set("WWW-Authenticate", "MeterBox").json({
          ...body,
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return res.status(result.status).json({ error: result.error });
    }
    const call = {
      name: ep.name,
      price: String(price),
      nonce: result.nonce.toString(),
      cumulative: result.cumulative.toString(),
      status: 200,
      at: new Date().toISOString(),
    };
    result.channel.calls.push(call);
    saveState();
    res.set("X-METERBOX-RECEIPT", JSON.stringify({ paid: String(price), nonce: call.nonce, resource: ep.name }));
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

async function settleChannel(req, res) {
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
  try {
    const providerKeypair = await loadProviderKeypair();
    if (!providerKeypair) return res.status(503).json({ error: "provider keypair is not configured" });
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
}

app.post("/api/channels/:id/settle", requireAdmin, settleChannel);

function verifySettlementRequest(req, res, next) {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  try {
    const { publicKey, signature } = req.body || {};
    if (!publicKey || !signature) return res.status(401).json({ error: "sign a settlement request with the payer or provider wallet" });
    const signer = new PublicKey(publicKey);
    if (signer.toBase58() !== channel.payer && signer.toBase58() !== channel.payee) {
      return res.status(403).json({ error: "settlement request signer is not authorized for this channel" });
    }
    const message = new TextEncoder().encode(
      `METERBOX_SETTLE_REQUEST_V1:${req.params.id}:${channel.lastNonce}:${channel.lastCumulative}`,
    );
    const signed = Buffer.from(signature, "base64");
    if (signed.length !== 64 || !nacl.sign.detached.verify(message, signed, signer.toBytes())) {
      return res.status(401).json({ error: "invalid settlement request signature" });
    }
    return next();
  } catch (error) {
    return res.status(400).json({ error: `invalid settlement request: ${error.message}` });
  }
}

app.post(
  "/api/public/channels/:id/settle",
  rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false }),
  verifySettlementRequest,
  settleChannel,
);

app.post("/api/channels/:id/close", requireAdmin, async (req, res) => {
  const channel = channelState(req.params.id);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  if (mode === "demo") return res.json({ mode: "demo", note: "Channel state closed in demo mode" });
  try {
    const providerKeypair = await loadProviderKeypair();
    if (!providerKeypair) return res.status(503).json({ error: "provider keypair is not configured" });
    if (!providerKeypair.publicKey.equals(new PublicKey(channel.payee))) {
      return res.status(403).json({ error: "provider keypair does not match the channel payee" });
    }
    const instruction = new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(channel.payer), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PROGRAM_ID), isSigner: false, isWritable: false },
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
    channel.closed = true;
    saveState();
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

async function recoverOnChainChannels() {
  if (mode !== "devnet") return;
  const programId = new PublicKey(PROGRAM_ID);
  const accounts = await connection.getProgramAccounts(programId, { filters: [{ dataSize: 153 }] });
  let recovered = 0;
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(programId)) continue;
    const channelPda = pubkey.toBase58();
    const decoded = await decodeChannelAccount(channelPda);
    if (!decoded) continue;
    const previous = state.channels[channelPda] || {};
    state.channels[channelPda] = {
      ...previous,
      ...decoded,
      policy: await decodeAgentPolicy(channelPda),
      lastCumulative: previous.lastCumulative && BigInt(previous.lastCumulative) > BigInt(decoded.settled)
        ? previous.lastCumulative
        : decoded.settled,
      calls: previous.calls || [],
      settlements: previous.settlements || [],
    };
    recovered += 1;
  }
  saveState();
  console.info(`Recovered ${recovered} open MeterBox channel(s) from devnet.`);
}

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  recoverOnChainChannels()
    .catch((error) => {
      console.error(`On-chain recovery failed: ${error.message}`);
      if (mode === "devnet") process.exitCode = 1;
    })
    .finally(() => {
      app.listen(port, "0.0.0.0", () => {
        console.log(`MeterBox API on :${port} (${mode.toUpperCase()} MODE)`);
      });
    });
}
