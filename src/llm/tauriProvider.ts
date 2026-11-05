import { invoke } from "@tauri-apps/api/core";
import type { LLMProvider } from "./provider";

/** Webview-safe provider: the Rust `llm_complete` command spawns the (locked-down) CLI. */
export const tauriProvider = (name: string): LLMProvider => ({
  async complete(prompt, opts = {}) {
    if (opts.signal?.aborted) throw new Error(`${name} aborted`);
    const args: Record<string, unknown> = { provider: name, prompt, system: opts.system, timeoutMs: opts.timeoutMs };
    if (opts.images?.length) args.images = opts.images;
    if (opts.model) args.model = opts.model;
    return invoke<string>("llm_complete", args);
  },
});
