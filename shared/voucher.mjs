export const PREFIX = new TextEncoder().encode("METERBOX_VOUCHER_V1");

export function buildVoucherMessage({ programId, channel, payee, cumulative, nonce }) {
  const enc = new TextEncoder();
  const parts = [
    PREFIX,
    enc.encode(programId.padEnd(32, "\0").slice(0, 32)),
    enc.encode(channel.padEnd(32, "\0").slice(0, 32)),
    enc.encode(payee.padEnd(32, "\0").slice(0, 32)),
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

export const PROGRAM_ID = "MeterBox1111111111111111111111111111111111";
export const PAYEE = "MeterBoxDemoPayee11111111111111111111";
export const CHANNEL = "demo-channel-1";

export const ENDPOINTS = [
  { path: "/api/paid/weather", name: "weather", price: 100_000 },
  { path: "/api/paid/sentiment", name: "sentiment", price: 200_000 },
  { path: "/api/paid/price", name: "price", price: 150_000 },
  { path: "/api/paid/search", name: "search", price: 300_000 },
  { path: "/api/paid/image-gen", name: "image", price: 1_000_000 },
];
