import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./config.mjs";

export const PREFIX = new TextEncoder().encode("METERBOX_VOUCHER_V1");
export { PROGRAM_ID };

export function publicKeyBytes(value) {
  return new PublicKey(value).toBytes();
}

export function deriveChannelPda(payer, payee, channelId, programId = PROGRAM_ID) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("channel"),
      publicKeyBytes(payer),
      publicKeyBytes(payee),
      u64(channelId),
    ],
    new PublicKey(programId),
  );
  return pda.toBase58();
}

export function buildVoucherMessage({ programId, channel, payee, cumulative, nonce }) {
  const parts = [
    PREFIX,
    publicKeyBytes(programId),
    publicKeyBytes(channel),
    publicKeyBytes(payee),
    u64(cumulative),
    u64(nonce),
  ];
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u64(n) {
  const b = new Uint8Array(8);
  const v = BigInt(n);
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b;
}

export const ENDPOINTS = [
  { path: "/api/paid/weather", name: "weather", price: 100_000 },
  { path: "/api/paid/sentiment", name: "sentiment", price: 200_000 },
  { path: "/api/paid/price", name: "price", price: 150_000 },
  { path: "/api/paid/search", name: "search", price: 300_000 },
  { path: "/api/paid/image-gen", name: "image", price: 1_000_000 },
];
