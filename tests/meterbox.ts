import assert from "node:assert/strict";
import nacl from "tweetnacl";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

describe("meterbox", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Meterbox as Program;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const payee = Keypair.generate();
  const agent = Keypair.generate();
  let channelId = 1;
  let channelPda: PublicKey;

  before(async () => {
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: payee.publicKey,
          lamports: 1_000_000_000,
        }),
      ),
      [payer],
    );
  });

  function deriveChannel(id: number) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("channel"),
        payer.publicKey.toBuffer(),
        payee.publicKey.toBuffer(),
        new BN(id).toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];
  }

  function voucherMessage(channel: PublicKey, cumulative: number, nonce: number) {
    const prefix = Buffer.from("METERBOX_VOUCHER_V1");
    return Buffer.concat([
      prefix,
      program.programId.toBuffer(),
      channel.toBuffer(),
      payee.publicKey.toBuffer(),
      new BN(cumulative).toArrayLike(Buffer, "le", 8),
      new BN(nonce).toArrayLike(Buffer, "le", 8),
    ]);
  }

  async function openChannel(deposit = 2_000_000, limit = 1_000_000) {
    const id = channelId++;
    const pda = deriveChannel(id);
    await program.methods
      .openChannel(new BN(id), agent.publicKey, new BN(deposit), new BN(limit), new BN(Math.floor(Date.now() / 1000) + 3600))
      .accounts({
        payer: payer.publicKey,
        payee: payee.publicKey,
        channel: pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
    return { id, pda };
  }

  async function settle(channel: PublicKey, cumulative: number, nonce: number, signer = agent, publicKey = agent.publicKey) {
    const message = voucherMessage(channel, cumulative, nonce);
    const signature = nacl.sign.detached(message, signer.secretKey);
    const ed = Ed25519Program.createInstructionWithPublicKey({
      publicKey: publicKey.toBytes(),
      message,
      signature,
    });
    const settleIx = await program.methods
      .settle(new BN(cumulative), new BN(nonce))
      .accounts({
        payee: payee.publicKey,
        channel,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(ed).add(settleIx);
    return provider.sendAndConfirm(tx, [payee]);
  }

  it("opens and settles a valid voucher", async () => {
    const open = await openChannel();
    channelPda = open.pda;
    await settle(open.pda, 100_000, 1);
    const account = await program.account.channel.fetch(open.pda);
    assert.equal(account.settled.toNumber(), 100_000);
    assert.equal(account.lastNonce.toNumber(), 1);
  });

  it("rejects a replayed nonce", async () => {
    const open = await openChannel();
    await settle(open.pda, 100_000, 1);
    await assert.rejects(() => settle(open.pda, 200_000, 1));
  });

  it("rejects a non-increasing amount", async () => {
    const open = await openChannel();
    await settle(open.pda, 100_000, 1);
    await assert.rejects(() => settle(open.pda, 100_000, 2));
  });

  it("rejects amount over spending limit", async () => {
    const open = await openChannel(2_000_000, 50_000);
    await assert.rejects(() => settle(open.pda, 50_001, 1));
  });

  it("rejects a non-payee settlement signer", async () => {
    const open = await openChannel();
    const message = voucherMessage(open.pda, 100_000, 1);
    const signature = nacl.sign.detached(message, agent.secretKey);
    const ed = Ed25519Program.createInstructionWithPublicKey({
      publicKey: agent.publicKey.toBytes(),
      message,
      signature,
    });
    const ix = await program.methods.settle(new BN(100_000), new BN(1)).accounts({
      payee: payee.publicKey,
      channel: open.pda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      rent: SYSVAR_RENT_PUBKEY,
    }).instruction();
    await assert.rejects(() => provider.sendAndConfirm(new Transaction().add(ed).add(ix), [payer]));
  });

  it("rejects a forged voucher signed by another key", async () => {
    const open = await openChannel();
    const forged = Keypair.generate();
    await assert.rejects(() => settle(open.pda, 100_000, 1, forged, forged.publicKey));
  });

  it("rejects a voucher for a different channel", async () => {
    const open = await openChannel();
    const other = deriveChannel(open.id + 100);
    await assert.rejects(() => settle(other, 100_000, 1));
  });

  it("rejects missing Ed25519 instruction", async () => {
    const open = await openChannel();
    const ix = await program.methods.settle(new BN(100_000), new BN(1)).accounts({
      payee: payee.publicKey,
      channel: open.pda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      rent: SYSVAR_RENT_PUBKEY,
    }).instruction();
    await assert.rejects(() => provider.sendAndConfirm(new Transaction().add(ix), [payee]));
  });

  it("does not allow payer close before expiry", async () => {
    const open = await openChannel();
    await assert.rejects(() => program.methods.closeChannel()
      .accounts({
        payer: payer.publicKey,
        payerSigner: payer.publicKey,
        payeeSigner: null,
        channel: open.pda,
      })
      .signers([payer])
      .rpc());
  });

  it("allows cooperative close by payee", async () => {
    const open = await openChannel();
    await program.methods.closeChannel()
      .accounts({
        payer: payer.publicKey,
        payerSigner: null,
        payeeSigner: payee.publicKey,
        channel: open.pda,
      })
      .signers([payee])
      .rpc();
  });
});
