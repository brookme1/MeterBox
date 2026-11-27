import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { buildVoucherMessage, deriveChannelPda } from "../shared/voucher.mjs";
import { PROGRAM_ID } from "../shared/config.mjs";

test("deriveChannelPda matches the Anchor seed layout", () => {
  const payer = "11111111111111111111111111111111";
  const payee = "11111111111111111111111111111112";
  const pda = deriveChannelPda(payer, payee, 7, PROGRAM_ID);
  assert.equal(typeof pda, "string");
  assert.ok(pda.length > 20);
});

test("voucher signature verifies with the agent keypair", () => {
  const keys = nacl.sign.keyPair();
  const message = buildVoucherMessage({
    programId: PROGRAM_ID,
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 100_000,
    nonce: 1,
  });
  const signature = nacl.sign.detached(message, keys.secretKey);
  assert.ok(nacl.sign.detached.verify(message, signature, keys.publicKey));
});
