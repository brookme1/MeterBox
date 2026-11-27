export function formatSol(value) {
  const lamports = BigInt(value || 0);
  const negative = lamports < 0n;
  const absolute = negative ? -lamports : lamports;
  const whole = absolute / 1_000_000_000n;
  const fraction = String(absolute % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""} SOL`;
}

export function solToLamports(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,9})?$/.test(text)) throw new Error("Enter a SOL amount with up to 9 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  return (BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"))).toString();
}

export function shorten(value, start = 5, end = 5) {
  const text = String(value || "");
  return text.length > start + end + 3 ? `${text.slice(0, start)}…${text.slice(-end)}` : text;
}

export function base64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
