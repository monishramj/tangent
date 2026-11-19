import type { LLMProvider } from "./provider";
import { tauriProvider } from "./tauriProvider";

// One entry per backend; add cursor/opencode/API/local here.
export const providers = {
  claude: tauriProvider("claude"),
  codex: tauriProvider("codex"),
  agy: tauriProvider("agy"),
} satisfies Record<string, LLMProvider>;

export type ProviderName = keyof typeof providers;
export const providerLabels: Record<ProviderName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
};
export const providerNames = Object.keys(providers) as ProviderName[];
const KEY = "tangent.provider";

export function getChoice(): ProviderName {
  try {
    const value = localStorage.getItem(KEY);
    if (value && providerNames.some(name => name === value)) return value as ProviderName;
  } catch { /* storage may be unavailable */ }
  return "claude";
}
export const setChoice = (n: ProviderName) => localStorage.setItem(KEY, n);


// Resolve at call time so the mounted library queue sees changes from Settings.
export const selectedProvider: LLMProvider = {
  complete: (prompt, opts) => providers[getChoice()].complete(prompt, opts),
};
