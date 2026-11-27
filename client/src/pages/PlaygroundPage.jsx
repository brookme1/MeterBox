import { useEffect, useState } from "react";
import nacl from "tweetnacl";
import { ENDPOINTS } from "../../../shared/voucher.mjs";
import { createMeterBoxFetch } from "../../../sdk/index.mjs";
import AddressLink from "../components/AddressLink.jsx";
import { ActionButton, EmptyState } from "../components/PageStates.jsx";
import { formatSol } from "../lib/format.mjs";

const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export default function PlaygroundPage({ wallet, health, openChannel, settleChannel, closeChannel, manageChannel, refresh, channels }) {
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settlement, setSettlement] = useState(null);
  const [closeSignature, setCloseSignature] = useState("");
  const [closed, setClosed] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  function addLog(text, kind = "info") {
    setLogs((previous) => [...previous, { text, kind, id: `${Date.now()}-${Math.random()}` }]);
  }

  async function fundAndOpen() {
    setBusy("open");
    setError("");
    setNotice("");
    try {
      const result = await openChannel({
        depositSol: "0.1",
        spendingLimitSol: "0.01",
        maxPerRequestSol: "0.002",
        dailyLimitSol: "0.01",
        airdrop: true,
      });
      setSession(result);
      setVouchers([]);
      setSettlement(null);
      setCloseSignature("");
      setClosed(false);
      addLog(`Channel opened · ${result.signature}`, "ok");
      setNotice("Channel funded and opened on devnet. The agent key exists only in this browser session.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function runRequests() {
    if (!session?.agentKeypair) {
      setError("Fund and open a channel with a generated demo agent key first.");
      return;
    }
    setBusy("run");
    setError("");
    setLogs([]);
    setVouchers([]);
    try {
      const fetchPaid = createMeterBoxFetch({
        agentKeypair: session.agentKeypair,
        channel: session.channel,
        baseUrl: apiBase,
        spendingLimitLamports: 10_000_000,
        onVoucher(voucher) {
          setVouchers((previous) => {
            const existing = previous.findIndex((row) => row.nonce === voucher.nonce);
            const item = { ...voucher, endpoint: ENDPOINTS[Number(voucher.nonce) - 1]?.name || "API" };
            if (existing < 0) return [...previous, item];
            const next = [...previous];
            next[existing] = item;
            return next;
          });
        },
      });
      for (const endpoint of ENDPOINTS) {
        const query = endpoint.name === "weather" ? "?city=Berlin" : endpoint.name === "price" ? "?symbol=SOL" : "";
        const url = `${endpoint.path}${query}`;
        addLog(`GET ${url}`);
        const response = await fetchPaid(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `${endpoint.name} request failed with ${response.status}`);
        addLog(`200 ${endpoint.name} · ${JSON.stringify(data)}`, "ok");
      }
      setNotice("5 paid requests completed. No settlement transaction has been sent yet.");
      await refresh();
    } catch (reason) {
      addLog(reason.message, "warn");
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function settle() {
    if (!session) return;
    setBusy("settle");
    setError("");
    try {
      const result = await settleChannel(session.channel);
      if (!result.signature) throw new Error(result.error || "Settlement returned no on-chain signature.");
      setSettlement(result);
      setVouchers((previous) => previous.map((row) => ({ ...row, settled: true })));
      addLog(`Settlement confirmed · ${result.signature}`, "ok");
      setNotice("Voucher ledger settled in one on-chain transaction.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  async function close() {
    if (!session) return;
    setBusy("close");
    setError("");
    try {
      const currentExpiry = Number(channel?.expiresAt || 0);
      if (currentExpiry > Math.floor(clock / 1000)) {
        await manageChannel("request_close", session.channel, 60);
        await refresh();
        setNotice("Close requested on-chain. The 60-second dispute window must expire before refund finalization.");
        return;
      }
      const signature = await closeChannel(session.channel);
      setClosed(true);
      setCloseSignature(signature);
      addLog(`Channel closed and remaining deposit refunded · ${signature}`, "ok");
      setNotice("Channel close confirmed. Remaining rent-exempt channel balance was returned to the payer.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy("");
    }
  }

  const channel = channels.find((item) => item.channelPda === session?.channel);
  const canSettle = session && vouchers.some((row) => row.verified) && !settlement;
  const canClose = session && settlement && !closed && Number(channel?.expiresAt || 0) > 0 && Number(channel.expiresAt) <= Math.floor(clock / 1000);
  const closeRequestNeeded = session && settlement && !closed && (!channel?.expiresAt || Number(channel.expiresAt) <= Math.floor(clock / 1000));

  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow">INTERACTIVE DEVNET DEMO</div><h1>Agent playground</h1><p className="muted">Open a real channel, make five signed API requests, then settle once.</p></div></div>
    <div className="playground-toolbar"><div className="playground-actions">
      <ActionButton busy={busy === "open"} disabled={!wallet.connected || !health?.providerPublicKey} onClick={fundAndOpen}>Fund and open channel</ActionButton>
      <ActionButton variant="secondary" busy={busy === "run"} disabled={!session || Boolean(settlement)} onClick={runRequests}>Run agent (5 requests)</ActionButton>
      <ActionButton variant="secondary" busy={busy === "settle"} disabled={!canSettle} onClick={settle}>Settle on Solana</ActionButton>
      <ActionButton variant="danger" busy={busy === "close"} disabled={!canClose && !closeRequestNeeded} onClick={close}>{canClose ? "Close and refund" : "Request close (60s)"}</ActionButton>
    </div><span className="demo-key-label"><span className="live-dot" /> DEMO-ONLY EPHEMERAL AGENT KEY</span></div>
    {!wallet.connected && <div className="banner banner-info">Connect your devnet wallet to create the channel. The wallet button is in the sidebar.</div>}
    {health?.mode !== "devnet" && <div className="banner banner-warn">API mode is <b>{health?.mode || "unknown"}</b>. Settlement and wallet flows require a devnet API.</div>}
    {error && <div className="status-message status-error" role="alert">{error}</div>}
    {notice && <div className="status-message status-success" role="status">{notice}</div>}
    <div className="playground-grid">
      <section className="panel playground-panel"><div className="panel-title"><span className="eyebrow">01 · HTTP TRACE</span><span className="live-label"><span className="live-dot" /> LIVE</span></div><div className="http-log">{logs.length ? logs.map((row) => <div key={row.id} className={`http-line ${row.kind}`}><span className="http-time">{new Date(Number(row.id.split("-")[0])).toLocaleTimeString()}</span><span>{row.text}</span></div>) : <EmptyState title="Waiting for requests">HTTP 402 negotiation and 200 responses appear here.</EmptyState>}</div></section>
      <section className="panel playground-panel"><div className="panel-title"><span className="eyebrow">02 · VOUCHER LEDGER</span><span className="ledger-count">{vouchers.length} / 5</span></div><div className="voucher-list">{vouchers.length ? vouchers.map((row) => <div className="voucher-row" key={row.nonce}><div className="voucher-top"><span className="nonce-chip">#{row.nonce}</span><b>{row.endpoint}</b><span className={row.verified ? "verify-tick" : "verify-pending"}>{row.verified ? "✓ verified" : "signing…"}</span></div><div className="voucher-amounts"><span>cumulative <b>{formatSol(row.cumulative)}</b></span><span>signature <code>{row.signature.slice(0, 10)}…</code></span></div>{row.settled && <span className="settled-tag">SETTLED</span>}</div>) : <EmptyState title="No vouchers yet">Signed vouchers are added after each paid endpoint request.</EmptyState>}</div></section>
      <section className="panel playground-panel counters-panel"><div className="panel-title"><span className="eyebrow">03 · SESSION</span><span className="network-chip"><span className="live-dot" /> DEVNET</span></div><div className="counter"><span>Off-chain requests</span><strong>{vouchers.filter((row) => row.verified).length}<small> / 5</small></strong></div><div className="counter"><span>On-chain transactions</span><strong>{(settlement ? 1 : 0) + (closed ? 1 : 0)}<small> settlement / close</small></strong></div>{session && <div className="session-address"><small>CHANNEL · OPEN TX BELOW</small><AddressLink value={session.channel} compact /></div>}{settlement?.signature && <div className="explorer-result"><span>Settlement transaction</span><AddressLink value={settlement.signature} kind="tx" compact /></div>}{closed && <div className="success-text">Channel closed and refunded</div>}</section>
    </div>
    {session && <div className="playground-footer"><span>Channel open transaction</span><AddressLink value={session.signature} kind="tx" compact />{settlement && <><span>Settlement transaction</span><AddressLink value={settlement.signature} kind="tx" compact /></>}{closeSignature && <><span>Close transaction</span><AddressLink value={closeSignature} kind="tx" compact /></>}</div>}
  </div>;
}
