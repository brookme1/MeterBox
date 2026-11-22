import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENDPOINTS,
  PAYEE,
  PROGRAM_ID,
  CHANNEL,
  buildVoucherMessage,
} from "../shared/voucher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const state = {
  agent: null,
  lastNonce: 0n,
  lastCumulative: 0n,
  settled: 0n,
  calls: [],
  settlements: [],
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "meterbox" });
});

app.post("/api/channels", (req, res) => {
  const { agentPublicKey } = req.body || {};
  if (!agentPublicKey || typeof agentPublicKey !== "string") {
    return res.status(400).json({ error: "agentPublicKey (base64) required" });
  }
  let bytes;
  try {
    bytes = Buffer.from(agentPublicKey, "base64");
  } catch {
    return res.status(400).json({ error: "bad public key" });
  }
  if (bytes.length !== 32) return res.status(400).json({ error: "public key must be 32 bytes" });
  state.agent = bytes;
  state.lastNonce = 0n;
  state.lastCumulative = 0n;
  res.json({
    channel: CHANNEL,
    payee: PAYEE,
    programId: PROGRAM_ID,
    agentPublicKey,
  });
});

app.get("/api/state", (_req, res) => {
  res.json({
    registered: Boolean(state.agent),
    lastNonce: state.lastNonce.toString(),
    lastCumulative: state.lastCumulative.toString(),
    settled: state.settled.toString(),
    unsettled: (state.lastCumulative - state.settled).toString(),
    calls: state.calls.slice(-50),
    settlements: state.settlements,
  });
});

app.post("/api/settle", (_req, res) => {
  if (state.lastCumulative <= state.settled) {
    return res.status(400).json({ error: "nothing to settle" });
  }
  const delta = state.lastCumulative - state.settled;
  state.settled = state.lastCumulative;
  const tx = {
    delta: delta.toString(),
    cumulative: state.settled.toString(),
    at: new Date().toISOString(),
    note: "dev settlement recorded by the API. On Solana this is one Ed25519+settle transaction.",
  };
  state.settlements.push(tx);
  res.json(tx);
});

function paywall(resource, price) {
  return {
    scheme: "meterbox",
    network: "solana-devnet",
    programId: PROGRAM_ID,
    payee: PAYEE,
    channel: CHANNEL,
    priceLamports: String(price),
    resource,
    lastAcceptedCumulative: state.lastCumulative.toString(),
    lastAcceptedNonce: state.lastNonce.toString(),
  };
}

function checkVoucher(req, price) {
  const header = req.get("x-meterbox-voucher");
  if (!header) return { ok: false, status: 402 };
  if (!state.agent) return { ok: false, status: 409, error: "open a channel first" };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "malformed voucher" };
  }
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
  if (nonce <= state.lastNonce) return { ok: false, status: 409, error: "nonce too low" };
  if (cumulative < state.lastCumulative + BigInt(price)) {
    return { ok: false, status: 402, error: "insufficient cumulative amount" };
  }
  const message = buildVoucherMessage({
    programId: PROGRAM_ID,
    channel: CHANNEL,
    payee: PAYEE,
    cumulative,
    nonce,
  });
  const valid = nacl.sign.detached.verify(message, signature, state.agent);
  if (!valid) return { ok: false, status: 401, error: "invalid signature" };
  state.lastNonce = nonce;
  state.lastCumulative = cumulative;
  return { ok: true, cumulative, nonce };
}

function paid(name, price, handler) {
  const pathName = ENDPOINTS.find((e) => e.name === name).path;
  app.all(pathName, (req, res) => {
    const result = checkVoucher(req, price);
    if (!result.ok) {
      if (result.status === 402) {
        return res
          .status(402)
          .set("WWW-Authenticate", "MeterBox")
          .json(paywall(pathName, price));
      }
      return res.status(result.status).json({ error: result.error });
    }
    state.calls.push({
      name,
      price,
      nonce: result.nonce.toString(),
      cumulative: result.cumulative.toString(),
      at: new Date().toISOString(),
    });
    const body = handler(req);
    res.set(
      "X-METERBOX-RECEIPT",
      JSON.stringify({ paid: String(price), nonce: result.nonce.toString(), resource: name }),
    );
    res.json(body);
  });
}

paid("weather", 100_000, (req) => ({
  city: req.query.city || "Berlin",
  tempC: 14,
  condition: "Partly cloudy",
  source: "meterbox",
}));
paid("sentiment", 200_000, () => ({ sentiment: "positive", score: 0.62, source: "meterbox" }));
paid("price", 150_000, (req) => ({
  symbol: req.query.symbol || "SOL",
  priceUsd: 178.4,
  source: "meterbox",
}));
paid("search", 300_000, (req) => ({
  query: req.query.q || "",
  results: [{ title: "Solana payment channels" }],
  source: "meterbox",
}));
paid("image", 1_000_000, () => ({
  imageUrl: "https://placehold.co/512x512/141725/14F195?text=MeterBox",
  source: "meterbox",
}));

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = process.env.PORT || 8787;
app.listen(port, "0.0.0.0", () => {
  console.log(`MeterBox API on :${port}`);
});
