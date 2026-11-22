import nacl from "tweetnacl";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createMeterBoxFetch } from "../../sdk/index.mjs";
import { deriveChannelPda, ENDPOINTS, PROGRAM_ID } from "../../shared/voucher.mjs";

const baseUrl = process.env.METERBOX_BASE_URL || "http://127.0.0.1:8787";
let payer = "11111111111111111111111111111111";
let payee = "11111111111111111111111111111112";
const channelId = Date.now() % 2147483647;
let channel = deriveChannelPda(payer, payee, channelId, PROGRAM_ID);
const keys = nacl.sign.keyPair();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

let deposit = "100000000";
let spendingLimit = "1750000";
if ((process.env.SOLANA_MODE || "demo") === "devnet") {
  const keyPath = process.env.PROVIDER_KEYPAIR_PATH || path.join(process.env.HOME || "", ".config/solana/id.json");
  const providerKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  payer = providerKeypair.publicKey.toBase58();
  payee = payer;
  channel = deriveChannelPda(payer, payee, channelId, PROGRAM_ID);
  const pda = channel;
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600);
  const data = Buffer.concat([
    createHash("sha256").update("global:open_channel").digest().subarray(0, 8),
    Buffer.from(new BN(channelId).toArrayLike(Buffer, "le", 8)),
    Buffer.from(new PublicKey(Buffer.from(keys.publicKey)).toBytes()),
    Buffer.from(new BN(deposit).toArrayLike(Buffer, "le", 8)),
    Buffer.from(new BN(spendingLimit).toArrayLike(Buffer, "le", 8)),
    Buffer.from(expiresAt.toArrayLike(Buffer, "le", 8)),
  ]);
  const openInstruction = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      { pubkey: providerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: providerKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(openInstruction);
  tx.feePayer = providerKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(providerKeypair);
  const openSignature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(openSignature, "confirmed");
  console.log(`Open transaction: https://explorer.solana.com/tx/${openSignature}?cluster=devnet`);
  console.log(`Opened devnet channel: ${pda}`);
  console.log(`https://explorer.solana.com/address/${pda}?cluster=devnet`);
}

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
  console.log(`  ${JSON.stringify(body)}`);
}
console.log("");
console.log(`Summary: ${calls} paid calls, ${(Number(spent) / 1e9).toFixed(5)} SOL, 0 on-chain transactions.`);

if ((process.env.SOLANA_MODE || "demo") === "devnet") {
  const headers = { "content-type": "application/json" };
  if (process.env.PROVIDER_ADMIN_TOKEN) headers["x-meterbox-admin-token"] = process.env.PROVIDER_ADMIN_TOKEN;
  const settle = await fetch(`${baseUrl}/api/channels/${channel}/settle`, { method: "POST", headers });
  const settleBody = await settle.json();
  console.log(settle.ok ? `Settlement: ${settleBody.explorerUrl}` : `Settlement failed: ${settleBody.error}`);
  const close = await fetch(`${baseUrl}/api/channels/${channel}/close`, { method: "POST", headers });
  const closeBody = await close.json();
  console.log(close.ok ? `Close/refund: ${closeBody.explorerUrl}` : `Close failed: ${closeBody.error}`);
}
