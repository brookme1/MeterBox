export const PROGRAM_ID =
  (typeof process !== "undefined" && process.env?.PROGRAM_ID)
    || (typeof import.meta !== "undefined" && import.meta.env?.VITE_PROGRAM_ID)
    || "2Nre79jBBYUmsZHLqjRTtouyjzBuyE9d8ciB6fPPqVpP";
