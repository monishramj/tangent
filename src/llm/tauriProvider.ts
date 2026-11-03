import { invoke } from "@tauri-apps/api/core";
import type { LLMProvider } from "./provider";

/** Webview-safe provider: the Rust `llm_complete` command spawns the CLI. */
export const tauriProvider = (name: string): LLMProvider => ({
  async complete(prompt, opts = {}) {
    if (opts.signal?.aborted) throw new Error(`${name} aborted`);
    return invoke<string>("llm_complete", { provider: name, prompt, system: opts.system, timeoutMs: opts.timeoutMs });
  },
});
