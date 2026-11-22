export const PROGRAM_ID =
  (typeof process !== "undefined" && process.env?.PROGRAM_ID)
    || (typeof import.meta !== "undefined" && import.meta.env?.VITE_PROGRAM_ID)
    || "Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz";
