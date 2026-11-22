import test from "node:test";
import assert from "node:assert/strict";
import { buildVoucherMessage } from "../shared/voucher.mjs";

test("voucher message is deterministic and includes the prefix", () => {
  const a = buildVoucherMessage({
    programId: "4CoXFP5uD1nxZwXqX7ws49nyaYnAEjPVE9GgWVmcQ865",
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 1000,
    nonce: 2,
  });
  const b = buildVoucherMessage({
    programId: "4CoXFP5uD1nxZwXqX7ws49nyaYnAEjPVE9GgWVmcQ865",
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 1000,
    nonce: 2,
  });
  assert.deepEqual(a, b);
  assert.equal(new TextDecoder().decode(a.slice(0, 19)), "METERBOX_VOUCHER_V1");
  assert.ok(a.length > 19 + 8 + 8);
});

test("golden voucher vector", () => {
  const message = buildVoucherMessage({
    programId: "4CoXFP5uD1nxZwXqX7ws49nyaYnAEjPVE9GgWVmcQ865",
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 1000,
    nonce: 2,
  });
  assert.equal(
    Buffer.from(message).toString("hex"),
    "4d45544552424f585f564f55434845525f56312f990d3dda26062b1d60b7d48c6154c0dc85189f831504b6b0a1f25cc1888bea00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e8030000000000000200000000000000",
  );
});
