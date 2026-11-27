import { useEffect, useMemo } from "react";
import { ConnectionProvider, useConnection, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { useWalletModal, WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import App from "./App.jsx";
import "@solana/wallet-adapter-react-ui/styles.css";

function ConnectedApp() {
  const adapter = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  useEffect(() => setVisible(true), [setVisible]);
  const wallet = useMemo(() => ({
    connected: adapter.connected,
    connecting: adapter.connecting,
    publicKey: adapter.publicKey,
    sendTransaction: adapter.sendTransaction,
    signMessage: adapter.signMessage,
    connection,
  }), [adapter.connected, adapter.connecting, adapter.publicKey, adapter.sendTransaction, adapter.signMessage, connection]);
  return <App wallet={wallet} walletButton={<WalletMultiButton className="wallet-button" />} />;
}

export default function ConnectedWalletApp() {
  const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl("devnet");
  const wallets = useMemo(() => [
    new PhantomWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
  ], []);
  return <ConnectionProvider endpoint={endpoint}><WalletProvider wallets={wallets} autoConnect><WalletModalProvider><ConnectedApp /></WalletModalProvider></WalletProvider></ConnectionProvider>;
}
