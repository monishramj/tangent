import { invoke } from "@tauri-apps/api/core";
import { getChoice, providerLabels, type ProviderName } from "@/llm/registry";

/** Mirrors `LaunchChecks` from `src-tauri/src/checks.rs`. No account fields. */
export type CheckState = "ok" | "missing" | "failed" | "timeout" | "signed_out" | "skipped" | "experimental";
export type LaunchChecks = { installed: CheckState; version: string | null; signedIn: CheckState; installations?: ProviderName[] };

export const PASSED_KEY = "tangent.checksPassed";
const passedKey = (provider: ProviderName) => provider === "claude" ? PASSED_KEY : `${PASSED_KEY}.${provider}`;
export const checksPassed = () => { try { return localStorage.getItem(passedKey(getChoice())) === "1"; } catch { return false; } };
export const markChecksPassed = () => localStorage.setItem(passedKey(getChoice()), "1");

export const runLaunchChecks = async (provider = getChoice()) => invoke<LaunchChecks>("launch_checks", { provider });

export type CheckRow = { id: string; ok: boolean; title: string; detail: string; fix?: string; command?: string; link?: string; pending?: boolean };

const INSTALL: Record<ProviderName, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://learn.chatgpt.com/docs/cli",
  agy: "https://antigravity.google/docs/install?tab=cli",
};
const INSTALL_CMD = "curl -fsSL https://claude.ai/install.sh | bash";
export const requiredOk = (r: LaunchChecks) => r.installed === "ok" && (r.signedIn === "ok" || r.signedIn === "experimental");

export function checkRows(r: LaunchChecks, provider: ProviderName = "claude"): CheckRow[] {
  const name = providerLabels[provider];
  const link = INSTALL[provider];
  const command = provider === "claude" ? INSTALL_CMD : undefined;
  const installFix = command
    ? `Install ${name}, then press Re-check. On a Mac or Linux, paste this into a terminal:`
    : `Install ${name}, then press Re-check.`;
  const loginFix = `Open a terminal, run ${provider}, and log in. Then press Re-check.`;
  const installed: CheckRow = r.installed === "ok"
    ? { id: provider, ok: true, title: name, detail: r.version ? `Installed (${r.version}).` : "Installed." }
    : r.installed === "timeout"
      ? { id: provider, ok: false, title: name, detail: "The install check timed out.", fix: `Wait a moment and press Re-check. If it keeps timing out, install ${name} again.`, link }
      : { id: provider, ok: false, title: name,
        detail: r.installed === "failed" ? `${name} didn't respond.` : `${name} isn't installed.`, fix: installFix, command, link };
  const login: CheckRow = r.signedIn === "ok"
    ? { id: "login", ok: true, title: "Signed in", detail: `You're logged in to ${name}.` }
    : r.signedIn === "timeout"
      ? { id: "login", ok: false, title: "Signed in", detail: "The login check timed out.", fix: loginFix }
      : r.signedIn === "signed_out"
        ? { id: "login", ok: false, title: "Signed in", detail: `${name} is installed, but you aren't logged in.`, fix: loginFix }
        : r.signedIn === "experimental"
          ? { id: "login", ok: true, title: "Experimental", detail: "Antigravity always comes with tools (commands, file edits) that Tangent can't turn off. Tangent sandboxes it and stops it the moment it tries one, but a crafted PDF is a small risk. Each call is also saved in your Antigravity history. Make sure you're signed in to agy; Tangent can't check." }
          : r.signedIn === "skipped"
            ? { id: "login", ok: false, pending: true, title: "Signed in", detail: r.installed === "missing" ? `Not checked yet. We'll check the login after ${name} is installed.` : "Not checked yet." }
            : { id: "login", ok: false, title: "Signed in", detail: "The login check failed.", fix: loginFix };
  return [installed, login];
}
