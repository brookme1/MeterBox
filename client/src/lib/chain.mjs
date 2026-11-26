import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { deriveChannelPda, PROGRAM_ID } from "../../../shared/voucher.mjs";

const SYSTEM = SystemProgram.programId;

function u64(value) {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), true);
  return buffer;
}

function i64(value) {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigInt64(0, BigInt(value), true);
  return buffer;
}

async function discriminator(name) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`));
  return new Uint8Array(digest).slice(0, 8);
}

function key(value, isSigner = false, isWritable = false) {
  return { pubkey: new PublicKey(value), isSigner, isWritable };
}

async function ix(name, keys, args = []) {
  const chunks = [await discriminator(name), ...args];
  const data = new Uint8Array(chunks.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return new TransactionInstruction({ programId: new PublicKey(PROGRAM_ID), keys, data });
}

export function channelAddress(payer, payee, channelId) {
  return deriveChannelPda(payer, payee, channelId, PROGRAM_ID);
}

export function policyAddress(channel) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("policy"), new PublicKey(channel).toBytes()],
    new PublicKey(PROGRAM_ID),
  )[0].toBase58();
}

export async function openChannelInstruction({ payer, payee, channel, channelId, agent, deposit, limit, expiresAt }) {
  return ix("open_channel", [
    key(payer, true, true),
    key(payee),
    key(channel, false, true),
    key(SYSTEM),
  ], [u64(channelId), new PublicKey(agent).toBytes(), u64(deposit), u64(limit), i64(expiresAt)]);
}

export async function manageInstruction(name, { payer, channel, value }) {
  const arg = name === "rotate_agent"
    ? new PublicKey(value).toBytes()
    : name === "request_close"
      ? i64(value)
      : u64(value);
  return ix(name, [key(payer, true, true), key(channel, false, true), key(SYSTEM)], [arg]);
}

export async function policyInstruction({ payer, channel, maxPerRequest, dailyLimit }) {
  return ix("set_agent_policy", [
    key(payer, true, true),
    key(channel),
    key(policyAddress(channel), false, true),
    key(SYSTEM),
  ], [u64(maxPerRequest), u64(dailyLimit)]);
}

export async function closeChannelInstruction({ payer, channel }) {
  return ix("close_channel", [
    key(payer, false, true),
    key(payer, true),
    key(PROGRAM_ID),
    key(channel, false, true),
  ]);
}

export async function submitTransaction(wallet, connection, instructions) {
  if (!wallet?.publicKey || !wallet.sendTransaction) throw new Error("Connect a Solana wallet to continue.");
  const transaction = new Transaction().add(...instructions);
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const signature = await wallet.sendTransaction(transaction, connection, { preflightCommitment: "confirmed" });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
