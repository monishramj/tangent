// One seam for every model backend: ClaudeCodeCLI (batch stages), Ollama (tutor fast path), API-key providers later.
export type CompleteOpts = {
  system?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Base64 PNGs (no data: prefix) shown to the model before the prompt. Providers without vision ignore them. */
  images?: string[];
};
export interface LLMProvider {
  /** Returns the raw text completion. `system` is optional. Rejects on timeout/failure. */
  complete(prompt: string, opts?: CompleteOpts): Promise<string>;
}
