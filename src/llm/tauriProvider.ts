import { traced } from "../devlog";
import type { LLMProvider } from "./provider";

/** Webview-safe provider: the Rust `llm_complete` command spawns the (locked-down) CLI. */
export const tauriProvider = (name: string): LLMProvider => ({
  async complete(prompt, opts = {}) {
    opts.signal?.throwIfAborted();
    const args: Record<string, unknown> = { provider: name, prompt, system: opts.system, timeoutMs: opts.timeoutMs };
    if (opts.images?.length) args.images = opts.images;
    if (opts.model) args.model = opts.model;
    const answer = await traced<string>("llm_complete", `${name}/${opts.model ?? "haiku"}`, args, opts.signal);
    opts.signal?.throwIfAborted();
    return answer;
  },
});
