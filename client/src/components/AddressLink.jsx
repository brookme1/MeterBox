import { useState } from "react";
import { shorten } from "../lib/format.mjs";

export default function AddressLink({ value, kind = "address", compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">—</span>;
  const url = `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("Could not copy to clipboard", error);
    }
  }
  return (
    <span className={`address-tools ${compact ? "compact" : ""}`}>
      <a className="mono address-text" href={url} target="_blank" rel="noreferrer" title={value}>
        {compact ? shorten(value) : value}
      </a>
      <button type="button" className="icon-btn" onClick={copy} aria-label={`Copy ${kind}`}>{copied ? "Copied" : "Copy"}</button>
      <a className="icon-btn explorer-link" href={url} target="_blank" rel="noreferrer">Explorer</a>
    </span>
  );
}
