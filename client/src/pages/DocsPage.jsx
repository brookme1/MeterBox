import AddressLink from "../components/AddressLink.jsx";

export default function DocsPage({ programId }) {
  return (
    <div className="page-enter">
      <div className="page-heading"><div><div className="eyebrow">BUILD WITH METERBOX</div><h1>Documentation</h1><p className="muted">A compact guide to channels, vouchers, and provider settlement.</p></div></div>
      <div className="docs-layout">
        <nav className="docs-nav"><a href="#quickstart">Quickstart</a><a href="#protocol">402 protocol</a><a href="#voucher">Voucher bytes</a><a href="#security">Security model</a></nav>
        <div className="docs-content">
          <section className="panel docs-card"><span className="eyebrow">PROGRAM</span><h2>Solana devnet deployment</h2><AddressLink value={programId} compact /></section>
          <section id="quickstart" className="panel docs-card"><span className="eyebrow">01 · QUICKSTART</span><h2>Agent SDK</h2><p>Install the SDK, create an agent keypair, and use the fetch wrapper for paid resources.</p><pre><code>{`import nacl from "tweetnacl";\nimport { createMeterBoxFetch } from "@meterbox/sdk";\n\nconst agentKeypair = nacl.sign.keyPair();\nconst paidFetch = createMeterBoxFetch({\n  agentKeypair,\n  channel: "<channel-pda>",\n  baseUrl: "https://provider.example",\n  spendingLimitLamports: 1_750_000,\n});\nconst response = await paidFetch("/api/paid/weather");`}</code></pre></section>
          <section className="panel docs-card"><span className="eyebrow">PROVIDER SDK</span><h2>Accept paid requests</h2><p>Use the shared voucher message format to verify signatures and track nonce/cumulative totals. The hosted MeterBox provider example is in <code>server/index.mjs</code>.</p><pre><code>{`// Voucher message (little-endian u64 values)\n"METERBOX_VOUCHER_V1" || programId || channel || payee\n  || cumulativeLamports || nonce`}</code></pre></section>
          <section id="protocol" className="panel docs-card"><span className="eyebrow">02 · HTTP 402</span><h2>One payment handshake</h2><ol className="protocol-list"><li>Agent requests a paid endpoint.</li><li>Provider returns <code>402 Payment Required</code> with the channel, payee, and price.</li><li>Agent signs the next cumulative voucher with Ed25519 and retries.</li><li>Provider verifies the signature and serves the response.</li><li>Provider settles the latest cumulative voucher on-chain.</li></ol></section>
          <section id="voucher" className="panel docs-card"><span className="eyebrow">03 · BYTE SPEC</span><h2>Voucher message layout</h2><div className="spec-table"><div><b>Prefix</b><span>19 bytes · UTF-8 "METERBOX_VOUCHER_V1"</span></div><div><b>Program ID</b><span>32 bytes · Solana public key</span></div><div><b>Channel PDA</b><span>32 bytes · Solana public key</span></div><div><b>Payee</b><span>32 bytes · Solana public key</span></div><div><b>Cumulative</b><span>8 bytes · unsigned little-endian lamports</span></div><div><b>Nonce</b><span>8 bytes · unsigned little-endian counter</span></div></div></section>
          <section id="security" className="panel docs-card"><span className="eyebrow">04 · SECURITY MODEL</span><h2>Keys stay with their owners</h2><ul className="security-list"><li>Payer wallet signs channel open and management transactions.</li><li>Agent keys sign vouchers locally; the browser playground uses a temporary keypair.</li><li>Provider settlement keys are server-side only and must never be exposed in frontend variables.</li><li>The program validates the Ed25519 instruction, agent, channel, cumulative amount, spending limit, and nonce.</li><li>Use devnet for testing. Review program state and deployment configuration before production use.</li></ul></section>
        </div>
      </div>
    </div>
  );
}
