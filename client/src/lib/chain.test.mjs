import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "../../../shared/config.mjs";
import { channelSequenceAddress, nextChannelId } from "./chain.mjs";

const payer = "11111111111111111111111111111111";
const payee = "11111111111111111111111111111112";

test("a new payer-payee pair starts with channel ID 1", async () => {
  const connection = { getAccountInfo: async () => null };

  assert.equal(await nextChannelId(connection, payer, payee), 1n);
});

test("reads the next ID only from a valid MeterBox sequence account", async () => {
  const data = Buffer.alloc(81);
  const accountDiscriminator = createHash("sha256")
    .update("account:ChannelSequence")
    .digest()
    .subarray(0, 8);
  data.set(accountDiscriminator);
  data.set(new PublicKey(payer).toBytes(), 8);
  data.set(new PublicKey(payee).toBytes(), 40);
  data.writeBigUInt64LE(42n, 72);
  const owner = new PublicKey(PROGRAM_ID);
  const expectedAddress = channelSequenceAddress(payer, payee);
  const connection = {
    getAccountInfo: async (address) => {
      assert.equal(address.toBase58(), expectedAddress);
      return { data, owner };
    },
  };

  assert.equal(await nextChannelId(connection, payer, payee), 42n);
});
