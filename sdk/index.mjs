import nacl from "tweetnacl";
import { buildVoucherMessage } from "../shared/voucher.mjs";

function b64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createMeterBoxFetch({
  agentKeypair,
  channel,
  baseUrl = "",
  spendingLimitLamports = 0n,
}) {
  let cumulative = 0n;
  let nonce = 0n;
  const limit = BigInt(spendingLimitLamports);
  return async function meterboxFetch(input, init = {}) {
    const url = `${baseUrl}${typeof input === "string" ? input : input.url}`;
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set("x-meterbox-channel", channel);
    let res = await fetch(url, { ...init, headers: requestHeaders });
    if (res.status !== 402) return res;
    const paywall = await res.clone().json();
    if (paywall.lastAcceptedCumulative != null) {
      const acceptedCumulative = BigInt(paywall.lastAcceptedCumulative);
      if (acceptedCumulative > cumulative) cumulative = acceptedCumulative;
    }
    if (paywall.lastAcceptedNonce != null) {
      const acceptedNonce = BigInt(paywall.lastAcceptedNonce);
      if (acceptedNonce > nonce) nonce = acceptedNonce;
    }
    const price = BigInt(paywall.priceLamports);
    const nextCumulative = cumulative + price;
    if (limit > 0n && nextCumulative > limit) {
      throw new Error(`MeterBox spending limit exceeded: ${nextCumulative} lamports`);
    }
    cumulative = nextCumulative;
    nonce += 1n;
    const message = buildVoucherMessage({
      programId: paywall.programId,
      channel,
      payee: paywall.payee,
      cumulative,
      nonce,
    });
    const signature = nacl.sign.detached(message, agentKeypair.secretKey);
    const payload = {
      channel,
      cumulativeAmount: cumulative.toString(),
      nonce: nonce.toString(),
      signature: b64(signature),
    };
    const header = b64(new TextEncoder().encode(JSON.stringify(payload)));
    const headers = new Headers(init.headers);
    headers.set("x-meterbox-channel", channel);
    headers.set("x-meterbox-voucher", header);
    return fetch(url, {
      ...init,
      headers,
    });
  };
}

export function meterboxMiddleware() {
  return {
    charge(priceLamports) {
      return function chargeMiddleware(req, res, next) {
        if (!req.get("x-meterbox-voucher")) {
          return res.status(402).json({
            scheme: "meterbox",
            priceLamports: String(priceLamports),
          });
        }
        next();
      };
    },
  };
}

export const meterbox = meterboxMiddleware();
