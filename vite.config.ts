import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

// Tauri applies app.security.csp only to the built app (tauri:// assets). `tauri dev` on desktop loads this server directly,
// so serve the same policy as a header here. Dev-only additions: HMR websocket, and inline scripts for React Fast Refresh's
// preamble (production stays 'self' only).
const csp: Record<string, string> = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
const hmr = host ? `ws://${host}:1421` : "ws://localhost:1420";
const devCsp = Object.entries({ ...csp, "script-src": `${csp["script-src"]} 'unsafe-inline'`, "connect-src": `${csp["connect-src"]} ${hmr}` })
  .map(([k, v]) => `${k} ${v}`).join("; ");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@motion": path.resolve(import.meta.dirname, "packages/motion/src"), "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "jsdom" },
  clearScreen: false,
  server: {
    port: 1420,
    headers: { "Content-Security-Policy": devCsp },
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
