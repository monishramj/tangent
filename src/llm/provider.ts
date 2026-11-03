// One seam for every model backend: ClaudeCodeCLI (batch stages), Ollama (tutor fast path), API-key providers later.
export interface LLMProvider {
  /** Returns the raw text completion. `system` is optional. Rejects on timeout/failure. */
  complete(prompt: string, opts?: { system?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<string>;
}
