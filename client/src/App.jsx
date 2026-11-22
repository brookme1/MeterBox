import { useEffect, useMemo, useState } from "react";
import nacl from "tweetnacl";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { deriveChannelPda, ENDPOINTS, PROGRAM_ID } from "../../shared/voucher.mjs";
import { createMeterBoxFetch } from "../../sdk/index.mjs";

const views = ["Playground", "Payer", "Provider", "Docs"];
const payer = "11111111111111111111111111111111";
const payee = "11111111111111111111111111111112";
const channelId = 1;
const channelPda = deriveChannelPda(payer, payee, channelId, PROGRAM_ID);
const b64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export default function App() {
  const [view, setView] = useState("Playground");
  const keys = useMemo(() => nacl.sign.keyPair(), []);
  const [logs, setLogs] = useState([]);
  const [rows, setRows] = useState([]);
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const log = (text, kind = "info") => setLogs((v) => [...v, { text, kind }]);

  async function refresh() {
    const r = await fetch(`/api/state?channel=${channelPda}`);
    setState(r.ok ? await r.json() : null);
  }

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    refresh();
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setState(data.channels?.[channelPda] || null);
    };
    return () => events.close();
  }, []);

  async function openChannel() {
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelPda,
        agentPublicKey: b64(keys.publicKey),
        payer,
        payee,
        channelId,
        deposit: "100000000",
        spendingLimit: "1750000",
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    log("Channel registered", "ok");
    await refresh();
  }

  async function runAgent() {
    setBusy(true);
    setLogs([]);
    setRows([]);
    try {
      await openChannel();
      const mbFetch = createMeterBoxFetch({
        agentKeypair: keys,
        channel: channelPda,
        baseUrl: "",
        spendingLimitLamports: 1_750_000,
      });
      let cumulative = 0n;
      let nonce = 0n;
      for (const ep of ENDPOINTS) {
        const url = ep.path + (ep.name === "weather" ? "?city=Berlin" : ep.name === "price" ? "?symbol=SOL" : "");
        log(`→ ${url}`, "req");
        const r = await mbFetch(url);
        const body = await r.json();
        log(`← ${r.status} ${ep.name}`, r.ok ? "ok" : "warn");
        if (r.ok) {
          cumulative = BigInt(state?.lastCumulative || 0) + BigInt(ep.price);
          nonce += 1n;
          setRows((v) => [...v, { nonce: nonce.toString(), api: ep.name, cumulative: cumulative.toString(), status: "VERIFIED" }]);
        } else if (body.error) {
          log(body.error, "warn");
        }
      }
      await refresh();
    } catch (e) {
      log(String(e.message || e), "warn");
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    const r = await fetch(`/api/channels/${channelPda}/settle`, {
      method: "POST",
      headers: { "x-meterbox-admin-token": import.meta.env.VITE_PROVIDER_ADMIN_TOKEN || "" },
    });
    const body = await r.json();
    if (!r.ok) {
      log(body.error || "Settle failed", "warn");
      return;
    }
    setRows((v) => v.map((row) => ({ ...row, status: "SETTLED" })));
    setToast(body.mode === "demo" ? "Settlement recorded in demo mode" : `Explorer: ${body.explorerUrl || ""}`);
    await refresh();
  }

  const endpointData = (state?.calls || []).reduce((out, call) => {
    const found = out.find((v) => v.name === call.name);
    if (found) found.value += Number(call.price);
    else out.push({ name: call.name, value: Number(call.price) });
    return out;
  }, []);

  return (
    <div className="app">
      <nav className="side">
        <div className="brand"><span className="brand-mark">M</span> MeterBox</div>
        {views.map((v) => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v}</button>)}
      </nav>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">SOLANA DEVNET</span>
            <span className="pill mode">{health?.mode === "demo" || health?.mode == null ? "DEMO MODE" : "DEVNET"}</span>
          </div>
          {toast && <button className="toast" onClick={() => setToast("")}>{toast} ×</button>}
        </header>
        {view === "Playground" && (
          <>
            <h1>Playground</h1>
            <p className="muted">Signed cumulative vouchers settle at the end of the session.</p>
            <div className="row">
              <button className="btn" onClick={openChannel}>Register channel</button>
              <button className="btn primary" disabled={busy} onClick={runAgent}>{busy ? "Running…" : "Run AI agent"}</button>
              <button className="btn" onClick={settle}>Settle</button>
            </div>
            <div className="cols">
              <section className="panel log mono">{logs.length === 0 ? <p className="muted">HTTP log is empty.</p> : logs.map((l, i) => <div key={i} className={l.kind}>{l.text}</div>)}</section>
              <section className="panel table-panel">
                <table><thead><tr><th>#</th><th>API</th><th>Σ lamports</th><th>Status</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.nonce}><td className="mono">{r.nonce}</td><td>{r.api}</td><td className="mono">{r.cumulative}</td><td><span className={r.status === "SETTLED" ? "pill settled" : "pill"}>{r.status}</span></td></tr>)}</tbody>
                </table>
              </section>
            </div>
          </>
        )}
        {view === "Payer" && (
          <>
            <h1>Payer</h1>
            <div className="grid">
              <div className="card"><div className="muted">Channel</div><div className="mono copy">{channelPda}</div></div>
              <div className="card"><div className="muted">Deposit</div><div className="mono">{state?.deposit || "100000000"}</div></div>
              <div className="card"><div className="muted">Spent</div><div className="mono">{state?.lastCumulative || "0"}</div></div>
              <div className="card"><div className="muted">Limit</div><div className="mono">{state?.spendingLimit || "1750000"}</div></div>
            </div>
          </>
        )}
        {view === "Provider" && (
          <>
            <h1>Provider</h1>
            <div className="grid">
              <div className="card"><div className="muted">Settled</div><div className="mono">{state?.settled || "0"}</div></div>
              <div className="card"><div className="muted">Unsettled</div><div className="mono">{state?.unsettled || "0"}</div></div>
              <button className="btn primary" onClick={settle}>Settle channel</button>
            </div>
            <section className="panel chart"><ResponsiveContainer width="100%" height={220}><BarChart data={endpointData}><XAxis dataKey="name" /><YAxis /><Bar dataKey="value" fill="#9945FF" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></section>
          </>
        )}
        {view === "Docs" && (
          <>
            <h1>Docs</h1>
            <section className="panel docs">
              <h2>Agent</h2><pre>{`const mb = createMeterBoxFetch({ agentKeypair, channel, baseUrl, spendingLimitLamports })\nawait mb("/api/paid/weather")`}</pre>
              <h2>Provider</h2><pre>{`app.get("/weather", meterbox.charge(100_000), handler)`}</pre>
              <h2>Flow</h2><p>Request → 402 → Ed25519 signed cumulative voucher → 200 → one settlement transaction.</p>
              <h2>Security</h2><p>The on-chain program verifies the Ed25519 instruction, agent public key, channel PDA, payee, cumulative amount, and nonce.</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
