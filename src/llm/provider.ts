// One seam for every model backend: desktop CLI providers and the Node-side Claude batch runner.
export type CompleteOpts = {
  system?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Base64 PNGs (no data: prefix) shown to the model before the prompt. Providers without vision reject attachments. */
  images?: string[];
  /** Fast (haiku) or strong (sonnet) tier. The provider maps the tier to its own model. */
  model?: "haiku" | "sonnet";
};
export interface LLMProvider {
  /** Returns the raw text completion. `system` is optional. Rejects on timeout/failure. */
  complete(prompt: string, opts?: CompleteOpts): Promise<string>;
}
