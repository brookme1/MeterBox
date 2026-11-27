import test from "node:test";
import assert from "node:assert/strict";
import { formatSol, solToLamports } from "./format.mjs";

test("SOL formatting preserves exact lamport precision", () => {
  assert.equal(formatSol("1800000"), "0.0018 SOL");
  assert.equal(formatSol("150000"), "0.00015 SOL");
  assert.equal(formatSol("1000000000"), "1 SOL");
});

test("SOL input conversion rejects precision beyond lamports", () => {
  assert.equal(solToLamports("0.0018"), "1800000");
  assert.throws(() => solToLamports("0.0000000001"), /up to 9 decimal places/);
});
