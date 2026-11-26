import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const WalletApp = lazy(() => import("./WalletApp.jsx"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense fallback={<div className="boot-state">Loading MeterBox…</div>}>
      <WalletApp />
    </Suspense>
  </StrictMode>,
);
