import { invoke } from "@tauri-apps/api/core";

/** Mirrors `LaunchChecks` from `src-tauri/src/checks.rs`. No account fields. */
export type CheckState = "ok" | "missing" | "failed" | "timeout" | "signed_out" | "skipped";
export type LaunchChecks = { installed: CheckState; version: string | null; signedIn: CheckState };

export const PASSED_KEY = "tangent.checksPassed";
export const checksPassed = () => { try { return localStorage.getItem(PASSED_KEY) === "1"; } catch { return false; } };
export const markChecksPassed = () => localStorage.setItem(PASSED_KEY, "1");

export const runLaunchChecks = () => invoke<LaunchChecks>("launch_checks");

export type CheckRow = { id: string; ok: boolean; title: string; detail: string; fix?: string };

const INSTALL = "https://code.claude.com/docs/en/setup";
const INSTALL_FIX = `Install Claude Code from ${INSTALL}. On a Mac or Linux you can run: curl -fsSL https://claude.ai/install.sh | bash. Then press Re-check.`;
const LOGIN_FIX = "Open a terminal, run claude, and log in. Then press Re-check.";

export const requiredOk = (r: LaunchChecks) => r.installed === "ok" && r.signedIn === "ok";

/** Plain-language rows. Ollama is intentionally absent: nothing in the app can prove it works. */
export function checkRows(r: LaunchChecks): CheckRow[] {
  const installedOk = r.installed === "ok";
  const installed: CheckRow = installedOk
    ? { id: "claude", ok: true, title: "Claude Code", detail: r.version ? `Installed (${r.version}).` : "Installed." }
    : r.installed === "timeout"
      ? { id: "claude", ok: false, title: "Claude Code", detail: "The install check timed out.", fix: "Wait a moment and press Re-check. If it keeps timing out, install Claude Code again from " + INSTALL + "." }
      : r.installed === "failed"
        ? { id: "claude", ok: false, title: "Claude Code", detail: "Claude Code didn't respond.", fix: INSTALL_FIX }
        : { id: "claude", ok: false, title: "Claude Code", detail: "Claude Code isn't installed.", fix: INSTALL_FIX };
  const login: CheckRow = r.signedIn === "ok"
    ? { id: "login", ok: true, title: "Signed in", detail: "You're logged in to Claude Code." }
    : r.signedIn === "timeout"
      ? { id: "login", ok: false, title: "Signed in", detail: "The login check timed out.", fix: LOGIN_FIX }
      : r.signedIn === "signed_out"
        ? { id: "login", ok: false, title: "Signed in", detail: "Claude Code is installed, but you aren't logged in.", fix: LOGIN_FIX }
        : r.signedIn === "skipped"
          ? { id: "login", ok: false, title: "Signed in", detail: r.installed === "missing" ? "We'll check the login after Claude Code is installed." : "Login wasn't checked.", fix: r.installed === "missing" ? LOGIN_FIX : "Press Re-check." }
          : { id: "login", ok: false, title: "Signed in", detail: "The login check failed.", fix: LOGIN_FIX };
  return [installed, login];
}
