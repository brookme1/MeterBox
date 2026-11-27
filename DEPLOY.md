# Devnet deployment guide

## Program status

The program is deployed and verified on Solana Devnet:

- Program ID: `2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP`.
- ProgramData address: `5vxVPmhFw7ngXTuhWBNbHXWAVh3JQwv6xMmVQExJUhGW`.
- Upgrade authority: `AtRLGAmrULYNsWgsfBjxa8scDW7ATjHb2w1GZ16pBPAg`.
- Last deployed at slot `526988964`; executable data length is 343,416 bytes.
- `solana program show` reported a 1.74543212 SOL program account balance.

The payer balance was 4.32040864 SOL at verification. These values are
time-sensitive; check the balance before any later transactions.

The wallet-connected Vercel source was confirmed by the successful Vercel check
for commit `dc8cf881f5d3ed33d5913a0cc142a1ac3c75da64`. That deployed build uses
the legacy program ID `Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz`.
This checkout uses the deployed program ID, but the live Vercel and Render
services have not been redeployed with it. Update their configuration only
after confirming the expected origins and server-only secrets.

The fresh program keypair is stored outside the repository at
`$HOME/.config/solana/meterbox-program-keypair.json` in WSL. Never print its
contents, commit it, upload it, or send it to Vercel/Render. The configured
fee payer and upgrade authority are `~/.config/solana/id.json`; the Phantom
channel payer and Render provider wallet are separate and must not be changed.

## Failed deployment buffers

The newly created failed buffer
`GFHtvGCwWWuEFCxJdTb4m7QQgwm3PR91gHUVrZ4UUwpE` was closed individually after
checking its size against the current binary. Its 1.74543212 SOL was recovered.
Two older buffers remain open and were not touched:

- `sUxia2zfDEsMYVTzZUEPxBqLPM3UY7Fz6kNjxAFW4Kw` — 1.307211 SOL.
- `HMVKZ1hsLoU2Gy8oqjYtAhETazWUTXNJ4BG4b3TQVcWQ` — 1.307211 SOL.

Never use `solana program close --buffers` for a single-buffer recovery; that
option can close every matching buffer. Name only the verified buffer address.

The shared Devnet RPC intermittently timed out on a cluster-version request.
The deployment succeeded using direct QUIC submission to validator TPUs with an
explicit local buffer signer, rather than forwarding all writes through
`--use-rpc`. Use the same approach for future uploads to this shared endpoint.

## 1. Build and test before deployment

Run all commands in WSL Ubuntu from the repository root:

```bash
export PROGRAM_ID=2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP
export VITE_PROGRAM_ID="$PROGRAM_ID"
export METERBOX_PROGRAM_KEYPAIR="$HOME/.config/solana/meterbox-program-keypair.json"

corepack pnpm@9.15.9 install --frozen-lockfile
corepack pnpm@9.15.9 build
corepack pnpm@9.15.9 test
anchor build -p meterbox --idl client/src/idl
anchor test
```

Confirm the configured deployment wallet and Devnet balance before any deploy:

```bash
solana config get
solana address
solana balance --url devnet
```

The balance shown is for the CLI fee payer, not the Phantom wallet used to open
a channel. Make sure it covers the current program rent plus fees; the deploy
command does not request an airdrop. Do not export or share its private key.

For a new deployment, create a unique local buffer signer outside the
repository. `--silent` prevents printing its recovery phrase:

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export METERBOX_BUFFER_KEYPAIR="$HOME/.config/solana/meterbox-devnet-buffer-$(date +%s).json"
set -e
test ! -e "$METERBOX_BUFFER_KEYPAIR"
umask 077
solana-keygen new --silent --no-bip39-passphrase \
  --outfile "$METERBOX_BUFFER_KEYPAIR"
chmod 600 "$METERBOX_BUFFER_KEYPAIR"
export METERBOX_BUFFER_ADDRESS="$(solana-keygen pubkey "$METERBOX_BUFFER_KEYPAIR")"
```

Deploy the existing binary under the existing program ID using QUIC:

```bash
solana program deploy target/deploy/meterbox.so \
  --program-id "$METERBOX_PROGRAM_KEYPAIR" \
  --fee-payer "$HOME/.config/solana/id.json" \
  --upgrade-authority "$HOME/.config/solana/id.json" \
  --buffer "$METERBOX_BUFFER_KEYPAIR" \
  --url "$SOLANA_RPC_URL" \
  --use-quic \
  --max-sign-attempts 10 \
  --commitment confirmed
```

Keep the same buffer signer to resume a failed upload. To recover a buffer
instead, first verify its address, authority, size, and balance, then close only
that account:

```bash
solana program close "$METERBOX_BUFFER_ADDRESS" \
  --authority "$HOME/.config/solana/id.json" \
  --recipient "$(solana address)" \
  --url "$SOLANA_RPC_URL"
```

Verify the program before deploying application changes:

```bash
solana program show "$PROGRAM_ID" --url "$SOLANA_RPC_URL"
```

The matching Devnet Explorer URL is
`https://explorer.solana.com/address/2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP?cluster=devnet`.

## 2. Deploy the API to Render

1. Sign in to [Render](https://render.com/) and choose **New → Blueprint**.
2. Connect `brookme1/MeterBox` and select the `main` branch.
3. Keep the service configuration from `render.yaml`. The service builds the
   frontend too so its production Express fallback remains available.
4. Choose a Render plan that supports a persistent disk. SQLite is stored at
   `/var/data/meterbox.sqlite`; without the mounted disk, channel history and
   endpoint prices will not survive service replacement.
5. In **Environment**, set:
   - `CLIENT_ORIGIN` to the exact Vercel origin (no trailing slash).
   - `SOLANA_MODE=devnet`.
   - `PROGRAM_ID=2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP`.
   - `SOLANA_RPC_URL` to a Devnet RPC endpoint.
   - `PROVIDER_KEYPAIR_BASE58` to the devnet provider keypair secret, using
     Render's secret field. Never put this value in Git, a Vercel variable, or
     browser code.
   - Keep `PROVIDER_ADMIN_TOKEN` generated by Render. It is for private
     administrative endpoints and must not be added to `VITE_*` variables.
6. Deploy and wait for `GET /api/health` to return `ok: true` and
   `GET /api/config` to show `mode: "devnet"` and the expected provider
   public address.

The existing provider wallet key must remain unchanged, and its public address
must match the payee used by new channels. The Solana program must already be
deployed to Devnet at the new program ID.

## 3. Deploy the frontend to Vercel

1. Sign in to [Vercel](https://vercel.com/) and choose **Add New → Project**.
2. Import `brookme1/MeterBox`; leave the project root at the repository root.
3. Use the Vite preset. `vercel.json` sets the install/build commands, output
   folder (`client/dist`), and SPA route fallback.
4. Add these environment variables for **Production**, **Preview**, and
   **Development** as needed:
   - `VITE_API_URL`: the Render service origin, with no trailing slash.
   - `VITE_SOLANA_RPC_URL`: optional dedicated devnet RPC URL. If omitted, the
     app uses Solana's public devnet RPC.
   - `VITE_PROGRAM_ID=2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP`.
   - Never add a program, provider, or fee-payer private key to Vercel.
5. Deploy. Set Render's `CLIENT_ORIGIN` to the Vercel origin, redeploy Render,
   then redeploy Vercel.

## 4. Verify

1. Open the Vercel URL and confirm the API badge says **DEVNET**.
2. Connect Phantom or Solflare on devnet.
3. In **Playground**, use **Fund and open channel**. If the faucet is throttled,
   fund the displayed payer address through Solana's devnet faucet and retry.
4. Run **Run agent (5 requests)**, then **Settle on Solana**. Confirm five
   verified vouchers and a settlement transaction link to Explorer with
   `?cluster=devnet`.
5. **Close and refund** first requests the on-chain 60-second dispute window.
   After it expires, the button finalizes the close and returns the remainder.

For local development, set `SOLANA_MODE=demo` in `.env`; demo settlement is
explicitly simulated and is not an on-chain transaction. For real Devnet
settlement, set `SOLANA_MODE=devnet` and configure the existing provider
keypair on the server only.
