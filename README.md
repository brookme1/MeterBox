# MeterBox

Payment infrastructure for autonomous AI agents on Solana.

AI agents cannot rely on cards for machine-to-machine API payments. Direct on-chain payments are slow and expensive for every call. MeterBox combines HTTP 402 paywalls with signed cumulative Ed25519 vouchers and one final Anchor settlement.

## How it works

```mermaid
sequenceDiagram
  participant Agent
  participant API
  participant Program
  Agent->>API: Paid API request
  API-->>Agent: 402 + price and accepted state
  Agent->>Agent: Sign cumulative voucher
  Agent->>API: Retry with voucher
  API->>API: Verify Ed25519 signature
  API-->>Agent: 200 response
  Provider->>Program: Ed25519 instruction + settle
  Program->>Program: Verify agent signature and voucher
  Program->>Payee: Transfer cumulative delta
```

## Quickstart

```bash
npm install
npm test
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

Production:

```bash
npm run build
npm start
```

## Modes

- `SOLANA_MODE=demo`: no wallet or keypair is required. The UI clearly shows DEMO MODE.
- `SOLANA_MODE=devnet`: configure the RPC, program ID, and provider keypair. The current environment must have a deployed program and provider keypair.

## SDK

Agent:

```js
import { createMeterBoxFetch } from "meterbox-sdk";
const mbFetch = createMeterBoxFetch({
  agentKeypair,
  channel,
  baseUrl: "http://localhost:8787",
  spendingLimitLamports: 1_750_000,
});
await mbFetch("/api/paid/weather");
```

Provider:

```js
import { meterbox } from "meterbox-sdk";
app.get("/weather", meterbox.charge(100_000), handler);
```

## Solana

- Program ID: `Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz`
- Explorer: https://explorer.solana.com/address/Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz?cluster=devnet
- Devnet status: **not yet deployed**. Wallet `AtRLGAmrULYNsWgsfBjxa8scDW7ATjHb2w1GZ16pBPAg` received no airdrop and has 0 SOL.
- Transaction signatures: pending deployment and real demo execution.
- Program source: `programs/meterbox/src/lib.rs`

The program keypair is generated locally under `data/meterbox-program.json`; that directory is git-ignored. It has not been deployed unless the deploy command has completed successfully.

Deploy:

```bash
npm run program:deploy
```

## Security model

The server verifies vouchers off-chain before returning API data. The Anchor settle instruction also verifies the previous Ed25519 instruction, the channel agent, the exact cumulative voucher message, nonce, limits, and rent-exempt minimum. Cooperative close is available to the payee; payer close is available after expiry.

## Honest limitations

- SOL channels only.
- The browser demo agent key is held in memory.
- Demo settlement is intentionally not an on-chain transaction.
- Devnet deploy and real wallet/close flows require the Solana/Anchor toolchain and funded wallet.
- The provider currently supports one payee per channel.

## Demo

```bash
npm run demo
npm run demo:agent
```

## License

MIT
