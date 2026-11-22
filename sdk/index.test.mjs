import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { buildVoucherMessage, deriveChannelPda } from "../shared/voucher.mjs";

test("deriveChannelPda matches the Anchor seed layout", () => {
  const payer = "11111111111111111111111111111111";
  const payee = "11111111111111111111111111111112";
  const program = "4CoXFP5uD1nxZwXqX7ws49nyaYnAEjPVE9GgWVmcQ865";
  const pda = deriveChannelPda(payer, payee, 7, program);
  assert.equal(typeof pda, "string");
  assert.ok(pda.length > 20);
});

test("voucher signature verifies with the agent keypair", () => {
  const keys = nacl.sign.keyPair();
  const message = buildVoucherMessage({
    programId: "4CoXFP5uD1nxZwXqX7ws49nyaYnAEjPVE9GgWVmcQ865",
    channel: "11111111111111111111111111111111",
    payee: "11111111111111111111111111111112",
    cumulative: 100_000,
    nonce: 1,
  });
  const signature = nacl.sign.detached(message, keys.secretKey);
  assert.ok(nacl.sign.detached.verify(message, signature, keys.publicKey));
});
