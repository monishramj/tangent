import type { LLMProvider } from "./provider";
import { tauriProvider } from "./tauriProvider";

// One entry per backend; add cursor/opencode/API/local here.
export const providers = {
  claude: tauriProvider("claude"),
  codex: tauriProvider("codex"),
} satisfies Record<string, LLMProvider>;

export type ProviderName = keyof typeof providers;
export const providerNames = Object.keys(providers) as ProviderName[];
const KEY = "tangent.provider";

export function getChoice(): ProviderName {
  const v = localStorage.getItem(KEY);
  return v && v in providers ? (v as ProviderName) : "claude";
}
export const setChoice = (n: ProviderName) => localStorage.setItem(KEY, n);
