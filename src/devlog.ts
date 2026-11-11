import { invoke } from "@tauri-apps/api/core";
// Dev-only: forwards webview events to the terminal (Rust dev_log) so freezes can be diagnosed without devtools.
const on = import.meta.env.DEV && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const devlog = (msg: string) => { if (on) void invoke("dev_log", { msg: `${new Date().toISOString().slice(11, 23)} ${msg}` }).catch(() => {}); };
if (on) {
  window.addEventListener("error", e => devlog(`window.error ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", e => devlog(`unhandledrejection ${String(e.reason)}`));
  // CSP (tauri.conf.json devCsp) blocks show up here instead of silently breaking a gif, figure or audio load.
  document.addEventListener("securitypolicyviolation", e => devlog(`CSP blocked ${e.effectiveDirective} ${e.blockedURI || "(inline)"} @${e.sourceFile}:${e.lineNumber}`));
}
