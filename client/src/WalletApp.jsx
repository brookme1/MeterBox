import { lazy, Suspense, useState } from "react";
import App from "./App.jsx";

const ConnectedWalletApp = lazy(() => import("./ConnectedWalletApp.jsx"));
const disconnectedWallet = { connected: false, connecting: false, publicKey: null };

export default function WalletApp() {
  const [walletRequested, setWalletRequested] = useState(false);
  if (walletRequested) {
    return <Suspense fallback={<div className="boot-state">Loading wallet adapters…</div>}><ConnectedWalletApp /></Suspense>;
  }
  return <App wallet={disconnectedWallet} walletButton={<button className="wallet-button" onClick={() => setWalletRequested(true)}>Connect wallet</button>} />;
}
