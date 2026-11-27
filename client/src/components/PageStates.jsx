export function PageError({ message, onRetry }) {
  return <div className="empty-state error-state"><strong>Something went wrong</strong><p>{message}</p>{onRetry && <button className="button button-secondary" onClick={onRetry}>Try again</button>}</div>;
}

export function EmptyState({ title, children, action }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><strong>{title}</strong><p>{children}</p>{action}</div>;
}

export function LoadingState({ label = "Loading…" }) {
  return <div className="inline-loading"><span className="spinner" />{label}</div>;
}

export function ActionButton({ children, busy, onClick, variant = "primary", disabled = false, ...props }) {
  return <button className={`button button-${variant}`} disabled={disabled || busy} onClick={onClick} {...props}>{busy ? <><span className="spinner spinner-small" /> Working…</> : children}</button>;
}

export function StatusMessage({ message, type = "success" }) {
  if (!message) return null;
  return <div className={`status-message status-${type}`} role={type === "error" ? "alert" : "status"}>{message}</div>;
}
