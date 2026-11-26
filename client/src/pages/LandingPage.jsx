export default function LandingPage({ navigate }) {
  return (
    <div className="landing-page page-enter">
      <section className="hero">
        <div className="eyebrow"><span className="live-dot" /> THE PAYMENT RAIL FOR AUTONOMOUS AGENTS</div>
        <h1>APIs get paid.<br /><span>Agents keep moving.</span></h1>
        <p className="hero-copy">MeterBox lets AI agents pay per request with signed vouchers. Five API calls, one on-chain settlement. No subscriptions. No friction.</p>
        <div className="hero-actions">
          <button className="button button-primary button-large" onClick={() => navigate("/app/playground")}>Launch playground <span>↗</span></button>
          <a className="button button-secondary button-large" href="https://github.com/brookme1/MeterBox" target="_blank" rel="noreferrer">View on GitHub ↗</a>
        </div>
        <div className="hero-trust"><span>Built on Solana</span><i /> <span>Non-custodial</span><i /> <span>Devnet beta</span></div>
      </section>
      <section className="flow-section">
        <div className="section-heading"><span className="eyebrow">THE 402 FLOW</span><span className="muted">One request cycle</span></div>
        <div className="flow-card">
          <div className="flow-topline"><span>AGENT → API</span><span className="flow-live"><span className="live-dot" /> LIVE SIMULATION</span></div>
          <div className="flow-steps">
            <div className="flow-step"><span className="step-number">01</span><span className="flow-icon cyan-icon">↗</span><strong>Request</strong><small>GET /v1/weather</small><span className="flow-status">sent</span></div>
            <div className="flow-arrow">→</div>
            <div className="flow-step"><span className="step-number">02</span><span className="flow-icon amber-icon">402</span><strong>Payment required</strong><small>0.0001 SOL</small><span className="flow-status warn-text">paywall</span></div>
            <div className="flow-arrow">→</div>
            <div className="flow-step"><span className="step-number">03</span><span className="flow-icon purple-icon">⌁</span><strong>Signed voucher</strong><small>Ed25519 · nonce 05</small><span className="flow-status">verified</span></div>
            <div className="flow-arrow">→</div>
            <div className="flow-step"><span className="step-number">04</span><span className="flow-icon green-icon">✓</span><strong>API response</strong><small>200 · paid</small><span className="flow-status">complete</span></div>
          </div>
          <div className="flow-bottom"><span>5 requests</span><span className="flow-dash" /><strong>1 settlement on Solana</strong><span className="flow-cost">0.0018 SOL</span></div>
        </div>
      </section>
      <section className="steps-section">
        <div className="section-heading"><span className="eyebrow">HOW IT WORKS</span><span className="muted">Open · Sign · Serve · Settle</span></div>
        <div className="steps-grid">
          {[
            ["01", "Open a channel", "Payer deposits SOL into a program-controlled channel."],
            ["02", "Sign vouchers", "Agent signs cumulative payments locally with Ed25519."],
            ["03", "Serve requests", "Provider verifies each voucher and returns the paid response."],
            ["04", "Settle once", "Provider settles the cumulative total in one transaction."],
          ].map(([number, title, copy]) => <article className="step-card" key={number}><span className="step-number">{number}</span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>
      <section className="highlight-banner">
        <div><span className="eyebrow">BUILT FOR AGENT ECONOMICS</span><h2>5 requests. <span>1 on-chain transaction.</span></h2></div>
        <button className="button button-primary" onClick={() => navigate("/app/playground")}>Try it on devnet <span>→</span></button>
      </section>
    </div>
  );
}
