import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

export default defineConfig({
  root: path.resolve("client"),
  plugins: [react(), nodePolyfills({ include: ["buffer"], globals: { Buffer: true } })],
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: { allow: [path.resolve(".")] },
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: {
    outDir: path.resolve("client/dist"),
    emptyOutDir: true,
  },
});
