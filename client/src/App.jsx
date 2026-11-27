import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "../../shared/voucher.mjs";
import {
  channelAddress,
  closeChannelInstruction,
  manageInstruction,
  nextChannelId,
  openChannelInstruction,
  policyInstruction,
  submitTransaction,
} from "./lib/chain.mjs";
import { base64, solToLamports } from "./lib/format.mjs";

const LandingPage = lazy(() => import("./pages/LandingPage.jsx"));
const PayerPage = lazy(() => import("./pages/PayerPage.jsx"));
const ProviderPage = lazy(() => import("./pages/ProviderPage.jsx"));
const PlaygroundPage = lazy(() => import("./pages/PlaygroundPage.jsx"));
const DocsPage = lazy(() => import("./pages/DocsPage.jsx"));

const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const routes = {
  "/": { name: "Overview", page: LandingPage },
  "/app/payer": { name: "Payer", page: PayerPage },
  "/app/provider": { name: "Provider", page: ProviderPage },
  "/app/playground": { name: "Playground", page: PlaygroundPage },
  "/docs": { name: "Docs", page: DocsPage },
};

async function request(path, options) {
  const response = await fetch(`${apiBase}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `API request failed (${response.status})`);
  return body;
}

function usePath() {
  const [path, setPath] = useState(() => routes[window.location.pathname] ? window.location.pathname : "/");
  useEffect(() => {
    const change = () => setPath(routes[window.location.pathname] ? window.location.pathname : "/");
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  const navigate = useCallback((next) => {
    if (!routes[next]) return;
    window.history.pushState(null, "", next);
    setPath(next);
  }, []);
  return [path, navigate];
}

export default function App({ wallet, walletButton }) {
  const [path, navigate] = usePath();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [agentKeys, setAgentKeys] = useState({});
  const [updated, setUpdated] = useState("");
  const current = routes[path];
  const modeName = (health?.mode || "loading").toUpperCase();

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const [healthResult, stateResult] = await Promise.all([
        request("/api/config"),
        request("/api/state"),
      ]);
      setHealth(healthResult);
      setChannels(Object.values(stateResult.channels || {}).reverse());
      setUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    let events;
    try {
      events = new EventSource(`${apiBase}/api/events`);
      events.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setChannels(Object.values(data.channels || {}).reverse());
        setUpdated(new Date().toLocaleTimeString());
      };
      events.onerror = () => setLoadError("Live updates are disconnected; retrying automatically.");
    } catch (error) {
      setLoadError(`Live updates could not start: ${error.message}`);
    }
    return () => {
      window.clearInterval(timer);
      events?.close();
    };
  }, [refresh]);

  const send = useCallback((instructions) => submitTransaction(wallet, wallet.connection, instructions), [wallet]);

  const openChannel = useCallback(async ({
    depositSol,
    spendingLimitSol,
    agentKeypair,
    agentPublicKey,
    maxPerRequestSol,
    dailyLimitSol,
    airdrop = false,
  }) => {
    if (!wallet.publicKey) throw new Error("Connect Phantom or Solflare first.");
    const providerAddress = health?.providerPublicKey;
    if (!providerAddress) throw new Error("The API has no devnet provider wallet configured.");
    const payer = wallet.publicKey.toBase58();
    const deposit = BigInt(solToLamports(depositSol));
    const limit = BigInt(solToLamports(spendingLimitSol));
    if (deposit <= 0n || limit <= 0n || limit > deposit) throw new Error("The spending limit must be greater than zero and no larger than the deposit.");
    if (airdrop) {
      const minimum = Number(deposit) + 10_000_000;
      const balance = await wallet.connection.getBalance(wallet.publicKey, "confirmed");
      if (balance < minimum) {
        try {
          const airdropSignature = await wallet.connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
          await wallet.connection.confirmTransaction(airdropSignature, "confirmed");
          const fundedBalance = await wallet.connection.getBalance(wallet.publicKey, "confirmed");
          if (fundedBalance < minimum) throw new Error("Airdrop confirmed, but the balance is still below the requested deposit and fee reserve.");
        } catch (error) {
          const latestBalance = await wallet.connection.getBalance(wallet.publicKey, "confirmed");
          if (latestBalance < minimum) {
            throw new Error(`Devnet faucet did not leave enough balance for this channel. Fund ${payer} at https://faucet.solana.com, then retry. Faucet response: ${error.message}`);
          }
        }
      }
    }
    const keys = agentKeypair || (agentPublicKey ? null : nacl.sign.keyPair());
    const agent = keys
      ? new PublicKey(keys.publicKey).toBase58()
      : new PublicKey(agentPublicKey).toBase58();
    const agentBytes = keys?.publicKey || new PublicKey(agent).toBytes();
    const channelId = await nextChannelId(wallet.connection, payer, providerAddress);
    const channel = channelAddress(payer, providerAddress, channelId);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
    const instructions = [await openChannelInstruction({
      payer,
      payee: providerAddress,
      channel,
      channelId,
      agent,
      deposit,
      limit,
      expiresAt,
    })];
    if (maxPerRequestSol && dailyLimitSol) {
      const maxPerRequest = BigInt(solToLamports(maxPerRequestSol));
      const dailyLimit = BigInt(solToLamports(dailyLimitSol));
      if (maxPerRequest <= 0n || maxPerRequest > dailyLimit || dailyLimit > limit) {
        throw new Error("Agent limits must satisfy max per request ≤ daily limit ≤ channel spending limit.");
      }
      instructions.push(await policyInstruction({ payer, channel, maxPerRequest, dailyLimit }));
    }
    const signature = await send(instructions);
    if (keys) setAgentKeys((previous) => ({ ...previous, [channel]: keys }));
    try {
      await request("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelPda: channel,
          agentPublicKey: base64(agentBytes),
          payer,
          payee: providerAddress,
          channelId: channelId.toString(),
          deposit: deposit.toString(),
          spendingLimit: limit.toString(),
        }),
      });
    } catch (error) {
      await refresh();
      throw new Error(`Channel transaction confirmed (${signature}), but provider registration failed: ${error.message}`);
    }
    await refresh();
    return { channel, channelId: channelId.toString(), agentKeypair: keys, agentPublicKey: agent, signature, providerAddress };
  }, [health, refresh, send, wallet]);

  const manageChannel = useCallback(async (name, channel, value) => {
    const signature = await send([await manageInstruction(name, {
      payer: wallet.publicKey.toBase58(),
      channel,
      value,
    })]);
    await request(`/api/channels/${channel}/sync`, { method: "POST" });
    await refresh();
    return signature;
  }, [refresh, send, wallet.publicKey]);

  const registerAgent = useCallback(async (channel, agentPublicKey) => {
    await request(`/api/channels/${channel}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentPublicKey }),
    });
    await refresh();
  }, [refresh]);

  const rotateAgent = useCallback(async (channel) => {
    const pair = nacl.sign.keyPair();
    const agent = new PublicKey(pair.publicKey).toBase58();
    const signature = await send([await manageInstruction("rotate_agent", {
      payer: wallet.publicKey.toBase58(),
      channel,
      value: agent,
    })]);
    await request(`/api/channels/${channel}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentPublicKey: base64(pair.publicKey) }),
    });
    setAgentKeys((previous) => ({ ...previous, [channel]: pair }));
    await refresh();
    return signature;
  }, [refresh, send, wallet.publicKey]);

  const closeChannel = useCallback(async (channel) => {
    const signature = await send([await closeChannelInstruction({
      payer: wallet.publicKey.toBase58(),
      channel,
    })]);
    try {
      await request(`/api/channels/${channel}/closed`, { method: "POST" });
    } catch (error) {
      throw new Error(`Close transaction confirmed (${signature}), but channel state sync failed: ${error.message}`);
    }
    await refresh();
    return signature;
  }, [refresh, send, wallet.publicKey]);

  const settleChannel = useCallback(async (channel) => {
    const selected = channels.find((item) => item.channelPda === channel);
    if (!selected) throw new Error("Channel state is not loaded.");
    if (!wallet.publicKey || !wallet.signMessage) throw new Error("Connect the payer or provider wallet to approve settlement.");
    const publicKey = wallet.publicKey.toBase58();
    if (publicKey !== selected.payer && publicKey !== selected.payee) {
      throw new Error("Connect this channel's payer or provider wallet to approve settlement.");
    }
    const message = new TextEncoder().encode(
      `METERBOX_SETTLE_REQUEST_V1:${channel}:${selected.lastNonce}:${selected.lastCumulative}`,
    );
    const signature = await wallet.signMessage(message);
    const result = await request(`/api/public/channels/${channel}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey, signature: base64(signature) }),
    });
    await refresh();
    return result;
  }, [channels, refresh, wallet.publicKey, wallet.signMessage]);

  const setAgentPolicy = useCallback(async (channel, maxPerRequestSol, dailyLimitSol) => {
    const signature = await send([await policyInstruction({
      payer: wallet.publicKey.toBase58(),
      channel,
      maxPerRequest: BigInt(solToLamports(maxPerRequestSol)),
      dailyLimit: BigInt(solToLamports(dailyLimitSol)),
    })]);
    await request(`/api/channels/${channel}/sync`, { method: "POST" });
    await refresh();
    return signature;
  }, [refresh, send, wallet.publicKey]);

  const savePricing = useCallback(async (prices) => {
    if (!wallet.publicKey || !wallet.signMessage) throw new Error("Connect a wallet that supports signed messages.");
    if (wallet.publicKey.toBase58() !== health?.providerPublicKey) {
      throw new Error("Connect the configured provider wallet before editing endpoint prices.");
    }
    const canonicalPrices = {};
    for (const endpoint of health.endpoints) canonicalPrices[endpoint.name] = solToLamports(prices[endpoint.name]);
    const message = new TextEncoder().encode(`METERBOX_PRICING_V1:${JSON.stringify(canonicalPrices)}`);
    const signature = await wallet.signMessage(message);
    const result = await request("/api/pricing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prices: canonicalPrices,
        signature: base64(signature),
        publicKey: wallet.publicKey.toBase58(),
      }),
    });
    await refresh();
    return result;
  }, [health, refresh, wallet.publicKey, wallet.signMessage]);

  const topUpChannel = useCallback(async (channel, amountSol) => {
    const signature = await send([await manageInstruction("top_up", {
      payer: wallet.publicKey.toBase58(),
      channel,
      value: BigInt(solToLamports(amountSol)),
    })]);
    await request(`/api/channels/${channel}/sync`, { method: "POST" });
    await refresh();
    return signature;
  }, [refresh, send, wallet.publicKey]);

  const closeHostedChannel = useCallback(async (channel) => {
    const result = await request(`/api/channels/${channel}/close`, { method: "POST" });
    await refresh();
    return result;
  }, [refresh]);

  const Page = current.page;
  const pageProps = useMemo(() => ({
    wallet,
    walletButton,
    health,
    channels,
    loading,
    loadError,
    updated,
    openChannel,
    manageChannel,
    registerAgent,
    rotateAgent,
    closeChannel,
    settleChannel,
    setAgentPolicy,
    savePricing,
    topUpChannel,
    closeHostedChannel,
    agentKeys,
    refresh,
    navigate,
  }), [wallet, walletButton, health, channels, loading, loadError, updated, openChannel, manageChannel, registerAgent, rotateAgent, closeChannel, settleChannel, setAgentPolicy, savePricing, topUpChannel, closeHostedChannel, agentKeys, refresh, navigate]);

  return (
    <div className="app-shell">
      <button className="mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation">☰</button>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <button className="brand" onClick={() => { navigate("/"); setSidebarOpen(false); }}>
          <span className="brand-mark">M</span><span>meterbox</span><span className="brand-beta">{modeName}</span>
        </button>
        <div className="nav-caption">WORKSPACE</div>
        {Object.entries(routes).map(([route, item]) => (
          <button key={route} className={`nav-item ${path === route ? "selected" : ""}`} onClick={() => { navigate(route); setSidebarOpen(false); }}>
            <span className={`nav-dot ${path === route ? "dot-active" : ""}`} />{item.name}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="network-status"><span className="live-dot" /> Solana {health?.mode || "network"}</div>
          {walletButton}
          <div className="sidebar-footer">5 API calls · 1 settlement</div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>MeterBox</span><span className="crumb-slash">/</span><strong>{current.name}</strong></div>
          <div className="topbar-right">
            <span className="network-chip"><span className="live-dot" /> {modeName}</span>
            <span className="updated-note">{updated ? `Updated ${updated}` : "Connecting…"}</span>
          </div>
        </header>
        {(loadError && !loading) && <div className="banner banner-error" role="alert">{loadError}<button onClick={refresh}>Retry</button></div>}
        <Suspense fallback={<div className="page-loading"><span className="spinner" /> Loading page…</div>}>
          <Page {...pageProps} programId={health?.programId || PROGRAM_ID} />
        </Suspense>
      </main>
    </div>
  );
}
