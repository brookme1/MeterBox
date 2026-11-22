import nacl from "tweetnacl";
import { createMeterBoxFetch } from "../../sdk/index.mjs";
import { deriveChannelPda, ENDPOINTS, PROGRAM_ID } from "../../shared/voucher.mjs";

const baseUrl = process.env.METERBOX_BASE_URL || "http://127.0.0.1:8787";
const payer = "11111111111111111111111111111111";
const payee = "11111111111111111111111111111112";
const channelId = Date.now() % 2147483647;
const channel = deriveChannelPda(payer, payee, channelId, PROGRAM_ID);
const keys = nacl.sign.keyPair();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

await fetch(`${baseUrl}/api/channels`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    channelPda: channel,
    agentPublicKey: b64(keys.publicKey),
    payer,
    payee,
    channelId,
    deposit: "100000000",
    spendingLimit: "1750000",
  }),
});

const mbFetch = createMeterBoxFetch({
  agentKeypair: keys,
  channel,
  baseUrl,
  spendingLimitLamports: 1_750_000,
});

console.log("MeterBox AI agent demo");
console.log("Task: Give me a morning brief for a SOL trader in Berlin.");
let spent = 0n;
let calls = 0;
for (const ep of ENDPOINTS.slice(0, 4)) {
  const url = ep.path + (ep.name === "weather" ? "?city=Berlin" : ep.name === "price" ? "?symbol=SOL" : "");
  const res = await mbFetch(url);
  const body = await res.json();
  calls++;
  spent += BigInt(ep.price);
  console.log(`✓ ${ep.name.padEnd(9)} ${ep.price.toLocaleString()} lamports  status=${res.status}  spent ${(Number(spent) / 1e9).toFixed(5)} SOL over ${calls} calls`);
  console.log(`  ${JSON.stringify(body).slice(0, 100)}`);
}
console.log("");
console.log(`Summary: ${calls} paid calls, ${(Number(spent) / 1e9).toFixed(5)} SOL, 0 on-chain transactions.`);
