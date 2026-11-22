export interface MeterBoxAgentKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function createMeterBoxFetch(options: {
  agentKeypair: MeterBoxAgentKeypair;
  channel: string;
  baseUrl: string;
  spendingLimitLamports?: bigint | number | string;
}): typeof fetch;

export function meterboxMiddleware(options?: { baseUrl?: string }): {
  charge(priceLamports: bigint | number | string): Function;
};

export const meterbox: {
  charge(priceLamports: bigint | number | string): Function;
};
