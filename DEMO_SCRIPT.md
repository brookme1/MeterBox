# MeterBox Hackathon Recording Script

Check the hackathon time limit before recording. The target is 2:30 to 3:00.

## Before recording

- Put devnet SOL in the wallet, if using devnet.
- Start the app with `corepack pnpm@9.15.9 dev`. For a real flow, run `corepack pnpm@9.15.9 demo:agent` in a second WSL terminal with `SOLANA_MODE=devnet`.
- Set browser zoom to 110-125%.
- Close extra tabs and hide bookmarks.
- Use dark mode. Increase terminal font size.
- Turn on Do Not Disturb.
- Put the terminal on the left and the dashboard on the right.

## Scenes

### 0:00-0:20 - Hook

**On screen:** Dashboard home.

**Say:** “AI agents need to pay for APIs, but cards do not work and every on-chain payment is slow and costly.”

### 0:20-0:40 - Idea

**On screen:** Docs page or README sequence diagram.

**Say:** “MeterBox uses signed vouchers. The agent pays only for API calls. There is one final settlement.”

**Flow:** Request, 402, sign, retry, 200, one settlement.

### 0:40-1:10 - Open channel

**On screen:** Payer dashboard and terminal. The devnet CLI demo opens the channel with the configured provider wallet and spending limit; the browser dashboard is read-only in devnet mode.

**Say:** “The CLI opens a devnet channel with a deposit and spending limit.”

**Visible:** Deposit, channel address, and open transaction Explorer link.

### 1:10-2:00 - AI agent

**On screen:** Terminal on the left. Dashboard on the right.

**Action:** Run `corepack pnpm@9.15.9 demo:agent` with `SOLANA_MODE=devnet` to open a real channel, make five signed API calls, settle, and close. In demo mode, use the dashboard Run AI agent button too.

**Say:** “The agent gets weather, sentiment, SOL price, search results, and image generation. It makes five paid calls and signs one cumulative voucher each time. Only the final result changes on-chain.”

**Visible:** Running cost, HTTP responses, ledger rows, and VERIFIED status.

### 2:00-2:30 - Settlement

**On screen:** Terminal settlement result and Solana Explorer transaction.

**Say:** “The program checks the agent signature on-chain, so the provider cannot take more than the agent signed.”

**Visible:** Real settlement transaction and Explorer page with Ed25519 and MeterBox instructions.

**Demo fallback:** If devnet is unavailable, clearly say demo settlement is recorded locally and not on-chain.

### 2:30-2:50 - Close and SDK

**On screen:** Close/refund transaction and SDK docs.

**Say:** “Closing refunds the unused deposit. MeterBox also provides SDK code for agents and providers.”

**Visible:** Close/refund transaction and two SDK snippets.

### 2:50-3:00 - Closing

**On screen:** Repo README.

**Say:** “MeterBox: payment infrastructure for autonomous AI agents on Solana.”

## If something goes wrong

- RPC slow: wait, then retry the action once.
- Airdrop fails: use an existing funded devnet wallet.
- Wallet popup is hidden: press Alt+Tab and accept the wallet popup.
- Terminal agent fails: verify the server URL, then use the dashboard Run AI agent button.
- Anthropic key is missing: the scripted agent still works offline.
- Devnet deployment fails: keep demo mode visible and say it clearly.

## Recording tips

- Record on-chain steps in separate takes.
- Speak slowly and keep the cursor movements smooth.
- Do not read code aloud.
- Add captions if needed.
- Export in 1080p.

## Hackathon description

MeterBox is payment infrastructure for autonomous AI agents on Solana. It replaces slow, costly per-call on-chain payments with signed cumulative vouchers. APIs use HTTP 402 to request payment, the agent signs each running total, and the provider verifies the voucher before returning data. One final Ed25519-verified Anchor settlement pays the provider. The app includes an SDK, live dashboard, persistent channel state, and a devnet-ready payment channel program.

**Tagline:** MeterBox: payment infrastructure for autonomous AI agents on Solana.

**Submission links:**

- Repository: add your GitHub repository URL.
- Live demo: add the deployed URL, if available.
- Video: add the uploaded demo video URL.
- Program ID for the prepared build: `2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP` (not yet deployed).
- The following are historical Devnet links from the previous build using program ID `Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz`; they do not verify the new program:
  - Channel open: https://explorer.solana.com/tx/3Rrot9MFcvMrifYRUDWpUKR2V4Mdk1nmJbMf3U974MPqYZpTGkRAkBGyG5uwKv4n1psYBd2pj9WNkdgNMn9CDLMB?cluster=devnet
  - Channel: https://explorer.solana.com/address/A2agETbFZQxePbvXpFJMX3tm8ZFjACNX9W4MhjUUVj9i?cluster=devnet
  - Settlement: https://explorer.solana.com/tx/3RbyDkM1MbBpLWM9acYdFsjNhy5Q9eJotQAu5SssunztmLZTMcYCWGo1zCuyEjMXhgRjJXBfVueftPGJZ7GYyBmT?cluster=devnet
  - Close/refund: https://explorer.solana.com/tx/3YxkM6edXEf3SvzAodNFE2uvPNc3dZA6ssziWNTr1eyY63mqeLtozf8zUsKbgztxjvuXFbQgwsjB6NzEbBUvAbrL?cluster=devnet
