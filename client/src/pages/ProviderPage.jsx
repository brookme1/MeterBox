import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AddressLink from "../components/AddressLink.jsx";
import { ActionButton, EmptyState } from "../components/PageStates.jsx";
import { formatSol } from "../lib/format.mjs";

function SettleControl({ channel, settleChannel, wallet }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  return <div className="settle-control">
    <ActionButton busy={busy} disabled={!wallet?.publicKey || (wallet.publicKey.toBase58() !== channel.payer && wallet.publicKey.toBase58() !== channel.payee)} onClick={async () => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await settleChannel(channel.channelPda);
        setMessage(result.signature
          ? { type: "success", value: result.signature }
          : { type: "warning", value: "Demo only — no on-chain transaction." });
      } catch (error) {
        setMessage({ type: "error", value: error.message });
      } finally {
        setBusy(false);
      }
    }}>Settle</ActionButton>
    {message?.type === "success" && <AddressLink value={message.value} kind="tx" compact />}
    {message && message.type !== "success" && <small className="warn-text">{message.value}</small>}
  </div>;
}

function ClosingCountdown({ expiresAt }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Number(expiresAt || 0) - now);
  if (!expiresAt) return "—";
  if (!remaining) return "Ready";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor(remaining % 86400 / 3600);
  const minutes = Math.floor(remaining % 3600 / 60);
  return `${days ? `${days}d ` : ""}${hours}h ${minutes}m`;
}

export default function ProviderPage({ channels, loading, loadError, refresh, settleChannel, health, savePricing, wallet }) {
  const [prices, setPrices] = useState({});
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceStatus, setPriceStatus] = useState("");
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState("");
  const calls = channels.flatMap((channel) => (channel.calls || []).map((call) => ({ ...call, channelPda: channel.channelPda })));
  const gross = calls.reduce((sum, call) => sum + BigInt(call.price || 0), 0n);
  const settled = channels.reduce((sum, channel) => sum + BigInt(channel.settled || 0), 0n);
  const unsettled = channels.reduce((sum, channel) => sum + BigInt(channel.unsettled || 0), 0n);
  const revenueSeries = useMemo(() => {
    const days = new Map();
    for (const call of calls) {
      const day = new Date(call.at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      days.set(day, (days.get(day) || 0) + Number(call.price || 0));
    }
    return [...days.entries()].map(([day, lamports]) => ({ day, sol: lamports / 1e9 }));
  }, [calls.length, channels]);
  const apiSeries = useMemo(() => {
    const counts = new Map();
    for (const call of calls) counts.set(call.name, (counts.get(call.name) || 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [calls.length, channels]);

  async function settleAll() {
    setSettleBusy(true);
    setSettleError("");
    try {
      for (const channel of channels) {
        if (BigInt(channel.unsettled || 0) > 0n) await settleChannel(channel.channelPda);
      }
      await refresh();
    } catch (error) {
      setSettleError(error.message);
    } finally {
      setSettleBusy(false);
    }
  }

  return <div className="page-enter">
    <div className="page-heading page-heading-row"><div><div className="eyebrow">PROVIDER WORKSPACE</div><h1>Revenue overview</h1><p className="muted">Track API revenue and settle verified channel balances.</p></div><div className="heading-actions"><span className="provider-wallet-label">Settlement wallet</span><AddressLink value={health?.providerPublicKey} compact /><ActionButton variant="secondary" busy={settleBusy} disabled={!wallet?.connected} onClick={settleAll}>Settle all</ActionButton></div></div>
    {settleError && <div className="status-message status-error" role="alert">{settleError}</div>}
    <div className="metric-grid">{[["Revenue", formatSol(gross), "From verified API calls"], ["Settled", formatSol(settled), "On-chain cumulative"], ["Unsettled", formatSol(unsettled), "Ready to settle"], ["Endpoints", "5", "Paid API routes"]].map(([label, value, note], i) => <div className="metric-card" key={label}><div className={`metric-icon metric-color-${i}`}>{["↗", "✓", "◌", "⌘"][i]}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-note">{note}</span></div>)}</div>
    <div className="chart-grid">
      <section className="panel chart-card"><div className="section-heading"><div><span className="eyebrow">REVENUE</span><h2>Paid API activity</h2></div><span className="chart-unit">SOL</span></div>
        <ResponsiveContainer width="100%" height={260}><AreaChart data={revenueSeries} margin={{ top: 12, right: 24, left: 18, bottom: 4 }}><defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9945FF" stopOpacity={0.28} /><stop offset="100%" stopColor="#9945FF" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} /><XAxis dataKey="day" tick={{ fill: "#85899c", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis width={72} tick={{ fill: "#85899c", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Number(value).toFixed(4)}`} /><Tooltip contentStyle={{ background: "#141725", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10 }} formatter={(value) => [`${Number(value).toFixed(6)} SOL`, "Revenue"]} /><Area type="monotone" dataKey="sol" stroke="#9945FF" strokeWidth={2} fill="url(#revenue-fill)" /></AreaChart></ResponsiveContainer>
      </section>
      <section className="panel chart-card"><div className="section-heading"><div><span className="eyebrow">REQUESTS</span><h2>Calls by API</h2></div></div>
        {apiSeries.length ? <div className="api-bars">{apiSeries.map(({ name, count }) => <div className="api-bar-row" key={name}><span>{name}</span><div className="api-track"><div style={{ width: `${Math.max(4, count / Math.max(...apiSeries.map((item) => item.count)) * 100)}%` }} /></div><b>{count}</b></div>)}</div> : <div className="chart-empty">Paid endpoint calls will appear here.</div>}
      </section>
    </div>
    <section className="netting-card"><div className="metric-icon metric-color-2">⌁</div><div><span className="eyebrow">VOUCHER NETTING</span><h2>{calls.length} calls → {channels.filter((channel) => BigInt(channel.unsettled || 0) > 0n).length} settlement{channels.filter((channel) => BigInt(channel.unsettled || 0) !== 1n).length === 1 ? "" : "s"}</h2><p className="muted">Verified off-chain vouchers net into one cumulative on-chain transaction per channel.</p></div><ActionButton busy={settleBusy} disabled={!wallet?.connected} onClick={settleAll}>Settle all channels</ActionButton></section>
    <div className="section-heading section-heading-spaced"><div><span className="eyebrow">CHANNELS</span><span className="section-title">{channels.length} channels</span></div><button className="text-button" onClick={refresh}>Refresh ↻</button></div>
    {loading ? <div className="inline-loading"><span className="spinner" /> Loading provider data…</div>
      : loadError && !channels.length ? <div className="empty-state error-state"><strong>Could not load provider data</strong><p>{loadError}</p><button className="button button-secondary" onClick={refresh}>Retry</button></div>
        : channels.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Payer</th><th>Agent</th><th>Cumulative</th><th>Settled</th><th>Unsettled</th><th>Status</th><th>Close timer</th><th>Action</th></tr></thead><tbody>{channels.map((channel) => <tr key={channel.channelPda}><td><AddressLink value={channel.payer} compact /></td><td><AddressLink value={channel.agent || channel.agentPublicKey} compact /></td><td>{formatSol(channel.lastCumulative || 0)}</td><td>{formatSol(channel.settled || 0)}</td><td>{formatSol(channel.unsettled || 0)}</td><td><span className={`status-pill ${channel.closed ? "status-closed" : "status-open"}`}>{channel.closed ? "CLOSED" : "ACTIVE"}</span></td><td><ClosingCountdown expiresAt={channel.expiresAt} /></td><td><SettleControl channel={channel} settleChannel={settleChannel} wallet={wallet} /></td></tr>)}</tbody></table></div>
          : <EmptyState title="No provider channels">New verified channels and settlement activity show here.</EmptyState>}
    <section className="panel pricing-panel"><div className="section-heading"><div><span className="eyebrow">ENDPOINT PRICING</span><h2>Current devnet rates</h2></div><span className="status-pill status-open">Provider wallet signature</span></div><div className="pricing-grid">{(health?.endpoints || []).map((endpoint) => <label key={endpoint.name}>{endpoint.name}<div className="price-input"><input value={prices[endpoint.name] ?? endpoint.priceSol} onChange={(event) => setPrices((old) => ({ ...old, [endpoint.name]: event.target.value }))} inputMode="decimal" /><span>SOL / request</span></div></label>)}</div><div className="pricing-actions"><p className="helper-text">Saving requires a signed message from the configured provider wallet. Prices persist in SQLite and apply to new requests.</p><ActionButton busy={priceBusy} disabled={!wallet?.connected || !savePricing} onClick={async () => { setPriceBusy(true); setPriceStatus(""); try { await savePricing(Object.fromEntries((health?.endpoints || []).map((endpoint) => [endpoint.name, prices[endpoint.name] ?? endpoint.priceSol]))); setPriceStatus("Prices saved and active."); } catch (error) { setPriceStatus(error.message); } finally { setPriceBusy(false); } }}>Save prices</ActionButton></div>{priceStatus && <div className={`status-message ${priceStatus.includes("saved") ? "status-success" : "status-error"}`}>{priceStatus}</div>}</section>
  </div>;
}
