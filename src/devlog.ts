import { invoke } from "@tauri-apps/api/core";
// Forwards webview events to Rust dev_log: the terminal in `tauri dev`, plus <app log dir>/dev.log when
// Developer mode is on (Settings), so a failed generation can be diagnosed from an installed build.
const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let on = desktop && import.meta.env.DEV;
export const devlog = (msg: string) => { if (on) void invoke("dev_log", { msg: `${new Date().toISOString().slice(11, 23)} ${msg}` }).catch(() => {}); };

export const devMode = async (): Promise<[boolean, string]> => (await invoke<[boolean, string] | null>("dev_mode")) ?? [false, ""];
export async function setDevMode(value: boolean) {
  await invoke("set_dev_mode", { on: value });
  on = value || import.meta.env.DEV;
}

async function invokeRequest<T>(cmd: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!signal) return invoke<T>(cmd, args);
  signal.throwIfAborted();
  // Register first so Rust sees a cancellation even when it arrives before the work command.
  const requestId = await invoke<number>("begin_request");
  let cancellation: Promise<unknown> | undefined;
  const cancel = () => { cancellation ??= invoke("cancel_request", { requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    // A sidecar batch already running can finish and its result can still be cached.
    return await invoke<T>(cmd, { ...args, requestId });
  } catch (e) {
    signal.throwIfAborted();
    throw e;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    await cancellation;
  }
}

/** invoke that, when logging, records the call's duration and any error (sidecar and LLM calls go through it). */
export async function traced<T>(cmd: string, label: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!on) return invokeRequest<T>(cmd, args, signal);
  const t0 = performance.now();
  try {
    const out = await invokeRequest<T>(cmd, args, signal);
    devlog(`${cmd} ${label} ok ${Math.round(performance.now() - t0)}ms`);
    return out;
  } catch (e) {
    devlog(`${cmd} ${label} FAILED ${Math.round(performance.now() - t0)}ms: ${String(e).slice(0, 2000)}`);
    throw e;
  }
}

if (desktop) {
  void devMode().then(([value]) => { if (value) on = true; }).catch(() => {});
  window.addEventListener("error", e => devlog(`window.error ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", e => devlog(`unhandledrejection ${String(e.reason)}`));
  // CSP (tauri.conf.json devCsp) blocks show up here instead of silently breaking a gif, figure or audio load.
  document.addEventListener("securitypolicyviolation", e => devlog(`CSP blocked ${e.effectiveDirective} ${e.blockedURI || "(inline)"} @${e.sourceFile}:${e.lineNumber}`));
}
