import test from "node:test";
import assert from "node:assert/strict";
import { buildVoucherMessage, PROGRAM_ID } from "../shared/voucher.mjs";

test("voucher message is deterministic and includes the prefix", () => {
  const a = buildVoucherMessage({
    programId: PROGRAM_ID,
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 1000,
    nonce: 2,
  });
  const b = buildVoucherMessage({
    programId: PROGRAM_ID,
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
    programId: PROGRAM_ID,
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 1000,
    nonce: 2,
  });
  assert.equal(
    Buffer.from(message).toString("hex"),
    "4d45544552424f585f564f55434845525f56311475030379822c7c93c0b1a677c7fb4b0142d4603d7923db65cd1205eda6b74c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e8030000000000000200000000000000",
  );
});
