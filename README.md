# MeterBox

MeterBox is an HTTP 402 payment rail for autonomous agents. Agents pay for API
requests with locally signed cumulative Ed25519 vouchers; the provider verifies
each voucher off-chain and settles the cumulative value on Solana in one
transaction.

**Five paid requests can net into one settlement transaction.** Channels use
SOL on Solana devnet and are funded and managed by the payer wallet.

## Product

- Landing page explains the 402 request → voucher → response → settlement flow.
- Payer dashboard opens and manages channels, updates limits, rotates agent
  keys, configures agent policy, and requests/finalizes channel close.
- Provider dashboard shows revenue, outstanding balances, request mix, channel
  status, and signed-message-protected endpoint pricing.
- Playground opens a real wallet-signed devnet channel, generates a temporary
  browser agent key, runs five signed requests, and settles through the
  server-side provider keypair.
- Docs cover the voucher format and security model.
- SQLite stores API state and endpoint pricing. On devnet startup the API
  reconciles open channel account data from the program.

## Deployment

- Program ID: [`2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP`](https://explorer.solana.com/address/2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP?cluster=devnet)
- The program is deployed and verified on Devnet (slot `526988964`).
- Repository: https://github.com/brookme1/MeterBox
- The fresh program keypair is stored locally in WSL at
  `~/.config/solana/meterbox-program-keypair.json`. Its private contents must
  never be committed, uploaded, or shared.
- The live Vercel build still uses the legacy `Ga2t...` program ID. Redeploy
  the frontend and API with the new ID before using the live wallet workflow.
- GitHub reports a successful Vercel deployment check for commit
  [`dc8cf88`](https://github.com/brookme1/MeterBox/commit/dc8cf881f5d3ed33d5913a0cc142a1ac3c75da64).
  That build uses the legacy program ID; see [DEPLOY.md](./DEPLOY.md) for the
  verified program status and app deployment steps.

See [DEPLOY.md](./DEPLOY.md) for exact Vercel/Render setup steps and the
required persistent disk and server-only secrets.

## Screenshots

Captured from the local **demo-mode** UI; they do not represent a completed
devnet browser-wallet session.

| Page | Screenshot |
| --- | --- |
| Landing | [landing.png](./docs/screenshots/landing.png) |
| Payer dashboard | [payer.png](./docs/screenshots/payer.png) |
| Provider dashboard | [provider.png](./docs/screenshots/provider.png) |
| Playground | [playground.png](./docs/screenshots/playground.png) |
| Docs | [docs.png](./docs/screenshots/docs.png) |
| Mobile payer | [payer-mobile.png](./docs/screenshots/payer-mobile.png) |
| Mobile playground | [playground-mobile.png](./docs/screenshots/playground-mobile.png) |

## Local setup

Run all Node, Anchor, Solana, and Rust commands in WSL Ubuntu from the
repository root, not from PowerShell.

```bash
corepack pnpm@9.15.9 install
cp .env.example .env
corepack pnpm@9.15.9 build
corepack pnpm@9.15.9 test
corepack pnpm@9.15.9 dev
```

Open `http://localhost:5173`. Demo mode is explicit and does not create real
on-chain settlements. To use the wallet flows, configure the API for devnet
and set `PROVIDER_KEYPAIR_PATH` or `PROVIDER_KEYPAIR_BASE58` on the server only.
Do not expose provider key material or `PROVIDER_ADMIN_TOKEN` through a
`VITE_*` variable.

## SDK quickstart

```js
import nacl from "tweetnacl";
import { createMeterBoxFetch } from "./sdk/index.mjs";

const agentKeypair = nacl.sign.keyPair();
const paidFetch = createMeterBoxFetch({
  agentKeypair,
  channel: "<channel-pda>",
  baseUrl: "http://localhost:8787",
  spendingLimitLamports: 1_750_000,
});
const response = await paidFetch("/api/paid/weather");
```

Providers can use the shared `buildVoucherMessage` format from
`shared/voucher.mjs`; the API example demonstrates voucher verification,
receipts, persistence, and provider-side settlement.

## Voucher and security model

The signed message is
`METERBOX_VOUCHER_V1 || programId || channel || payee || cumulativeLamports || nonce`.
Public keys are 32 bytes; cumulative and nonce are unsigned 64-bit little-endian
values. Each request's detached signature uses the agent's Ed25519 key.

The Anchor program validates the Ed25519 instruction and exact voucher message
before settling. The payer wallet signs channel creation and management.
Per-payer/payee channel sequence accounts allocate strictly increasing channel
IDs and persist after close, preventing a closed PDA and its old vouchers from
being reused.
Provider signing material remains server-side; API pricing updates require a
message signed by the configured provider wallet. Playground-generated agent
keys are demo-only and remain in browser memory. Use devnet, not production
funds.

## Tests

```bash
corepack pnpm@9.15.9 test
anchor test
```

The Node suite covers API and SDK behavior, including replay, tampering, forged
signatures, and spending limits. Anchor integration tests cover valid and
rejected settlements plus payer channel management.
