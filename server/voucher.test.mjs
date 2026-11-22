import test from "node:test";
import assert from "node:assert/strict";
import { buildVoucherMessage } from "../shared/voucher.mjs";

test("voucher message is deterministic and includes the prefix", () => {
  const a = buildVoucherMessage({
    programId: "prog",
    channel: "chan",
    payee: "payee",
    cumulative: 1000,
    nonce: 2,
  });
  const b = buildVoucherMessage({
    programId: "prog",
    channel: "chan",
    payee: "payee",
    cumulative: 1000,
    nonce: 2,
  });
  assert.deepEqual(a, b);
  assert.equal(new TextDecoder().decode(a.slice(0, 19)), "METERBOX_VOUCHER_V1");
  assert.ok(a.length > 19 + 8 + 8);
});
