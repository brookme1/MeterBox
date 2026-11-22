# MeterBox

Payment infrastructure for autonomous AI agents.

Agents pay per API call with signed cumulative vouchers. The provider verifies the signature off-chain and settles the running total once.

## What runs today

| Piece | Where | How |
| --- | --- | --- |
| HTTP API (402 paywall, Ed25519 verify, settle ledger) | `server/` | `npm run dev` |
| Web app (playground, payer, provider, docs) | `client/` | same command, port 5173 |
| Solana program source (Anchor) | `programs/meterbox` | `anchor build` when the Solana toolchain is installed |

The API is the backend. It rejects unpaid calls, checks the voucher signature with tweetnacl, and records settlement. It does not submit a Solana transaction by itself. That step is the Anchor `settle` instruction.

## Run

```bash
npm install
npm test
npm run dev
```

Open the printed Vite URL. Use **Run agent (5 requests)**. Each call returns 402, the browser signs a voucher, and the retry returns 200. **Settle** records one settlement for the series.

Production:

```bash
npm run build
npm start
```

## Voucher

`METERBOX_VOUCHER_V1` plus program id, channel, payee, cumulative amount, and nonce. The browser and the API share `shared/voucher.mjs`.

## License

MIT
