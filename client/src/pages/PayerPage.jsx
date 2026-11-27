import { useEffect, useState } from "react";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import AddressLink from "../components/AddressLink.jsx";
import { ActionButton, EmptyState } from "../components/PageStates.jsx";
import { base64, formatSol, solToLamports } from "../lib/format.mjs";

function Action({ label, action, work, busy, setBusy, setStatus, disabled = false }) {
  return <div className="action-control"><ActionButton variant="secondary" busy={busy === action} disabled={disabled} onClick={async () => {
    setBusy(action);
    setStatus(null);
    try {
      const signature = await work();
      setStatus({ type: "success", action, signature });
    } catch (error) {
      setStatus({ type: "error", action, message: error.message });
    } finally {
      setBusy("");
    }
  }}>{label}</ActionButton>{status?.action === action && <span className={status.type === "success" ? "success-text" : "warn-text"}>{status.type === "success" ? <AddressLink value={status.signature} kind="tx" compact /> : status.message}</span>}</div>;
}

function ChannelCard({ channel, props }) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);
  const [topUp, setTopUp] = useState("0.01");
  const [limit, setLimit] = useState((Number(channel.spendingLimit || 0) / 1e9).toString());
  const [agentMax, setAgentMax] = useState("0.002");
  const [daily, setDaily] = useState("0.01");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const spent = BigInt(channel.lastCumulative || 0);
  const max = BigInt(channel.spendingLimit || 0);
  const progress = max ? Number(spent * 10_000n / max) / 100 : 0;
  const expiry = Number(channel.expiresAt || 0);
  const seconds = Math.max(0, expiry - now);
  const timer = seconds ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : expiry ? "Ready to finalize" : "Not requested";

  return <article className="channel-card">
    <div className="channel-card-head"><div><span className="eyebrow">CHANNEL</span><AddressLink value={channel.channelPda} compact /></div><span className="status-pill status-open">{channel.closed ? "CLOSED" : "ACTIVE"}</span></div>
    <div className="channel-parties">
      <div><small>PROVIDER</small><AddressLink value={channel.payee} compact /></div>
      <div><small>AGENT</small><AddressLink value={channel.agent || channel.agentPublicKey} compact /></div>
    </div>
    <div className="channel-progress-head"><span>Spent · {formatSol(spent)}</span><span>Limit · {formatSol(max)}</span></div>
    <div className="progress-track"><div className="progress-value" style={{ width: `${progress}%` }} /></div>
    <div className="channel-metrics"><span><small>Deposited</small><b>{formatSol(channel.deposit)}</b></span><span><small>Unsettled</small><b>{formatSol(channel.unsettled || 0)}</b></span><span><small>Close timer</small><b>{timer}</b></span></div>
    <details className="channel-actions"><summary>Manage channel <span>Top up · spending · agent · close</span></summary>
      <div className="manage-grid">
        <label>Top up (SOL)<input value={topUp} onChange={(e) => setTopUp(e.target.value)} inputMode="decimal" /></label>
        <Action label="Top up" action="topup" busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.topUpChannel(channel.channelPda, topUp)} />
        <label>Spending limit (SOL)<input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></label>
        <Action label="Update limit" action="limit" busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.manageChannel("update_spending_limit", channel.channelPda, BigInt(solToLamports(limit)))} />
        <label>Max/request (SOL)<input value={agentMax} onChange={(e) => setAgentMax(e.target.value)} inputMode="decimal" /></label>
        <label>Daily limit (SOL)<input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="decimal" /></label>
        <Action label="Save agent rules" action="policy" busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.setAgentPolicy(channel.channelPda, agentMax, daily)} />
        <Action label="Rotate agent" action="rotate" busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.rotateAgent(channel.channelPda)} />
        <label>Dispute window (seconds)<input id={`dispute-${channel.channelPda}`} defaultValue="3600" inputMode="numeric" /></label>
        <Action label="Request close" action="request-close" busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.manageChannel("request_close", channel.channelPda, Number(document.getElementById(`dispute-${channel.channelPda}`).value))} />
        <Action label="Finalize close & refund" action="close" disabled={!expiry || seconds > 0 || channel.closed} busy={busy} setBusy={setBusy} setStatus={setStatus} work={() => props.closeChannel(channel.channelPda)} />
      </div>
      {props.agentKeys[channel.channelPda] && <details className="agent-secret"><summary>Show demo agent secret (sensitive)</summary><code>{base64(props.agentKeys[channel.channelPda].secretKey)}</code><button className="button button-secondary" onClick={() => navigator.clipboard.writeText(base64(props.agentKeys[channel.channelPda].secretKey))}>Copy secret key</button></details>}
    </details>
    <details className="technical-details"><summary>Technical details</summary><div>Channel ID <span className="mono">{channel.channelId}</span></div><div>Deposit <span className="mono">{channel.deposit} lamports</span></div><div>Limit <span className="mono">{channel.spendingLimit} lamports</span></div></details>
  </article>;
}

function CreateDialog({ props, close }) {
  const [deposit, setDeposit] = useState("0.1");
  const [limit, setLimit] = useState("0.01");
  const [maxPer, setMaxPer] = useState("0.002");
  const [daily, setDaily] = useState("0.01");
  const [agent, setAgent] = useState("");
  const [pair, setPair] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await props.openChannel({ depositSol: deposit, spendingLimitSol: limit, maxPerRequestSol: maxPer, dailyLimitSol: daily, agentKeypair: pair, agentPublicKey: agent || undefined }));
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
    <section className="modal-card" role="dialog" aria-modal="true">
      <button className="modal-close" onClick={close} aria-label="Close">×</button>
      {result ? <><span className="eyebrow">DEVNET CONFIRMED</span><h2>Channel opened</h2><AddressLink value={result.channel} compact /><AddressLink value={result.signature} kind="tx" compact />{result.agentKeypair && <div className="agent-secret"><b>Demo agent secret key — copy and keep it safe</b><code>{base64(result.agentKeypair.secretKey)}</code><button className="button button-secondary" onClick={() => navigator.clipboard.writeText(base64(result.agentKeypair.secretKey))}>Copy secret</button></div>}<button className="button button-primary full-width" onClick={close}>Done</button></>
        : <><span className="eyebrow">PAYER ACTION</span><h2>Create a channel</h2><form className="form-stack" onSubmit={submit}>
          <label>Provider address<input value={props.health?.providerPublicKey || ""} readOnly placeholder="Provider is not configured" /></label>
          <div className="form-row"><label>Deposit (SOL)<input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" /></label><label>Spending limit (SOL)<input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></label></div>
          <div className="form-row"><label>Max per request (SOL)<input value={maxPer} onChange={(e) => setMaxPer(e.target.value)} inputMode="decimal" /></label><label>Daily limit (SOL)<input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="decimal" /></label></div>
          <label>Agent public key<input value={pair ? new PublicKey(pair.publicKey).toBase58() : agent} onChange={(e) => { setAgent(e.target.value); setPair(null); }} placeholder="Paste an agent key or generate one" /></label>
          <button type="button" className="button button-secondary" onClick={() => { setPair(nacl.sign.keyPair()); setAgent(""); }}>Generate demo-only agent key</button>
          {pair && <p className="helper-text">Key is generated in this browser; you will be shown the secret after the transaction.</p>}
          {error && <div className="status-message status-error">{error}</div>}
          <ActionButton busy={busy} disabled={!props.wallet.connected || !props.health?.providerPublicKey} type="submit">Open channel on devnet</ActionButton>
        </form></>}
    </section>
  </div>;
}

export default function PayerPage(props) {
  const [modal, setModal] = useState(false);
  const { channels = [], loading, loadError, wallet } = props;
  const deposited = channels.reduce((sum, channel) => sum + BigInt(channel.deposit || 0), 0n);
  const spent = channels.reduce((sum, channel) => sum + BigInt(channel.lastCumulative || 0), 0n);
  const remaining = channels.reduce((sum, channel) => sum + BigInt(channel.deposit || 0) - BigInt(channel.lastCumulative || 0), 0n);
  return <div className="page-enter">
    <div className="page-heading page-heading-row"><div><div className="eyebrow">PAYER WORKSPACE</div><h1>Your channels</h1><p className="muted">Deposits, agent policies, and channel close windows.</p></div><div className="heading-actions">{props.walletButton}<button className="button button-primary" disabled={!wallet.connected} onClick={() => setModal(true)}>＋ Create channel</button></div></div>
    <div className="metric-grid">{[["Deposited", formatSol(deposited), "Across channels"], ["Spent", formatSol(spent), "Voucher cumulative"], ["Remaining", formatSol(remaining), "Available balance"], ["Active agents", String(channels.filter((channel) => !channel.closed).length), "Across open channels"]].map(([label, value, note], i) => <div className="metric-card" key={label}><div className={`metric-icon metric-color-${i}`}>{["↓", "↗", "◌", "⌘"][i]}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-note">{note}</span></div>)}</div>
    <div className="section-heading section-heading-spaced"><div><span className="eyebrow">CHANNELS</span><span className="section-title">{channels.length} total</span></div><button className="text-button" onClick={props.refresh}>Refresh ↻</button></div>
    {loading ? <div className="inline-loading"><span className="spinner" /> Loading channel state…</div>
      : loadError && !channels.length ? <div className="empty-state error-state"><strong>Could not load channels</strong><p>{loadError}</p><button className="button button-secondary" onClick={props.refresh}>Retry</button></div>
        : channels.length ? <div className="channels-grid">{channels.map((channel) => <ChannelCard key={channel.channelPda} channel={channel} props={props} />)}</div>
          : <EmptyState title="No channels yet">Open a devnet channel to start funding agent requests.<div className="empty-actions">{props.walletButton}<button className="button button-primary" disabled={!wallet.connected} onClick={() => setModal(true)}>Create a channel</button></div></EmptyState>}
    <section className="activity-section"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><span className="section-title">Recent activity</span></div></div><div className="activity-list">{channels.flatMap((channel) => (channel.calls || []).slice(-3).map((call) => ({ channel, call }))).slice(-10).reverse().map(({ channel, call }) => <div className="activity-row" key={`${channel.channelPda}-${call.nonce}`}><span className="activity-icon">↗</span><span><b>{call.name}</b><small>{new Date(call.at).toLocaleString()}</small></span><strong>{formatSol(call.price)}</strong><AddressLink value={channel.channelPda} compact /></div>)}{!channels.some((channel) => channel.calls?.length) && <div className="empty-inline">No paid requests yet. Use Playground to create demo activity.</div>}</div></section>
    {modal && <CreateDialog props={props} close={() => setModal(false)} />}
  </div>;
}
