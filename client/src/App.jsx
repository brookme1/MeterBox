import { useMemo, useState } from "react";
import nacl from "tweetnacl";
import { ENDPOINTS, PAYEE, PROGRAM_ID, CHANNEL, buildVoucherMessage } from "../../shared/voucher.mjs";

const views = ["Playground", "Payer", "Provider", "Docs"];

function b64(bytes) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

export default function App() {
  const [view, setView] = useState("Playground");
  const keys = useMemo(() => nacl.sign.keyPair(), []);
  const [logs, setLogs] = useState([]);
  const [rows, setRows] = useState([]);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);

  const log = (text, kind) => setLogs((l) => [...l, { text, kind }]);

  async function refresh() {
    const r = await fetch("/api/state");
    setState(await r.json());
  }

  async function openChannel() {
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentPublicKey: b64(keys.publicKey) }),
    });
    if (!r.ok) throw new Error(await r.text());
    setOpened(true);
    log("channel opened, agent key registered on the API", "ok");
    await refresh();
  }

  async function callPaid(ep, cumulative, nonce) {
    const url = ep.path + (ep.name === "weather" ? "?city=Berlin" : ep.name === "price" ? "?symbol=SOL" : "");
    log(`→ ${url}`, "req");
    let res = await fetch(url);
    log(`← ${res.status}`, res.status === 402 ? "warn" : "ok");
    if (res.status !== 402) return res;
    const message = buildVoucherMessage({
      programId: PROGRAM_ID,
      channel: CHANNEL,
      payee: PAYEE,
      cumulative,
      nonce,
    });
    const signature = nacl.sign.detached(message, keys.secretKey);
    const header = btoa(
      JSON.stringify({
        channel: CHANNEL,
        cumulativeAmount: String(cumulative),
        nonce: String(nonce),
        signature: b64(signature),
      }),
    );
    log(`  signed nonce ${nonce} cumulative ${cumulative}`, "info");
    res = await fetch(url, { headers: { "x-meterbox-voucher": header } });
    log(`← ${res.status} ${ep.name}`, res.ok ? "ok" : "warn");
    return res;
  }

  async function runAgent() {
    setBusy(true);
    setLogs([]);
    setRows([]);
    try {
      if (!opened) await openChannel();
      let cumulative = 0;
      let nonce = 0;
      for (const ep of ENDPOINTS) {
        cumulative += ep.price;
        nonce += 1;
        const res = await callPaid(ep, cumulative, nonce);
        if (res.ok) {
          setRows((rows) => [
            ...rows,
            { nonce, api: ep.name, cumulative, status: "VERIFIED" },
          ]);
        }
      }
      await refresh();
    } catch (e) {
      log(String(e.message || e), "warn");
    }
    setBusy(false);
  }

  async function settle() {
    const r = await fetch("/api/settle", { method: "POST" });
    const body = await r.json();
    log(r.ok ? `settled delta ${body.delta}` : body.error || "settle failed", r.ok ? "ok" : "warn");
    if (r.ok) setRows((rows) => rows.map((row) => ({ ...row, status: "SETTLED" })));
    await refresh();
  }

  return (
    <div className="app">
      <nav className="side">
        <div className="brand">MeterBox</div>
        {views.map((v) => (
          <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </nav>
      <main>
        {view === "Playground" && (
          <>
            <h1>Playground</h1>
            <p className="muted">
              The browser signs vouchers. The API verifies them and only then serves the paid response.
            </p>
            <div className="row">
              <button className="btn" onClick={openChannel}>Open channel</button>
              <button className="btn primary" disabled={busy} onClick={runAgent}>
                {busy ? "Running…" : "Run agent (5 requests)"}
              </button>
              <button className="btn" onClick={settle}>Settle</button>
            </div>
            <div className="cols">
              <section className="panel log mono">
                {logs.length === 0 && <p className="muted">HTTP log is empty.</p>}
                {logs.map((l, i) => (
                  <div key={i} className={l.kind}>{l.text}</div>
                ))}
              </section>
              <section className="panel">
                <table>
                  <thead>
                    <tr><th>#</th><th>API</th><th>Σ lamports</th><th></th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.nonce}>
                        <td className="mono">{r.nonce}</td>
                        <td>{r.api}</td>
                        <td className="mono">{r.cumulative}</td>
                        <td><span className={r.status === "SETTLED" ? "pill settled" : "pill"}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )}
        {view === "Payer" && (
          <>
            <h1>Payer</h1>
            <p className="muted">Agent public key is registered with the API when you open a channel.</p>
            <div className="grid">
              <div className="card"><div className="muted">Channel</div><div className="mono">{opened ? CHANNEL : "not open"}</div></div>
              <div className="card"><div className="muted">Payee</div><div className="mono">{PAYEE.slice(0, 18)}…</div></div>
              <div className="card"><div className="muted">Calls</div><div className="mono">{state?.calls?.length ?? 0}</div></div>
            </div>
          </>
        )}
        {view === "Provider" && (
          <>
            <h1>Provider</h1>
            <div className="grid">
              <div className="card"><div className="muted">Settled</div><div className="mono">{state?.settled ?? "0"}</div></div>
              <div className="card"><div className="muted">Unsettled</div><div className="mono">{state?.unsettled ?? "0"}</div></div>
              <div className="card"><div className="muted">Endpoints</div><div className="mono">5</div></div>
            </div>
            <p className="muted">Hit Settle on the playground. The API records one settlement for every accepted voucher series.</p>
          </>
        )}
        {view === "Docs" && (
          <>
            <h1>Docs</h1>
            <p className="muted">
              A request without <span className="mono">X-METERBOX-VOUCHER</span> returns 402. The agent signs
              cumulative lamports and a nonce. The server checks the Ed25519 signature before responding.
              The Anchor program in <span className="mono">programs/meterbox</span> is the on-chain settlement
              path (build with Anchor, deploy to devnet).
            </p>
          </>
        )}
      </main>
    </div>
  );
}
