import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FirstLaunch from "./FirstLaunch";
import type { LaunchChecks } from "./checks";

afterEach(() => { cleanup(); localStorage.clear(); });

const states: Record<string, LaunchChecks> = {
  missing: { installed: "missing", version: null, signedIn: "skipped" },
  signedOut: { installed: "ok", version: "2.1.44 (Claude Code)", signedIn: "signed_out" },
  ok: { installed: "ok", version: "2.1.44 (Claude Code)", signedIn: "ok" },
  timeout: { installed: "timeout", version: null, signedIn: "skipped" },
};

async function show(result: LaunchChecks, onContinue = vi.fn()) {
  render(<FirstLaunch check={() => Promise.resolve(result)} onContinue={onContinue} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Re-check" }) as HTMLButtonElement).disabled).toBe(false));
  return onContinue;
}

it("shows install steps and blocks Continue when Claude Code is missing", async () => {
  const onContinue = await show(states.missing);
  expect(screen.getByText("Claude Code isn't installed.")).toBeTruthy();
  expect(screen.getByText(/code.claude.com\/docs\/en\/setup/)).toBeTruthy();
  expect(screen.getByText(/curl -fsSL https:\/\/claude.ai\/install.sh/)).toBeTruthy();
  expect(screen.queryByText(/ollama/i)).toBeNull();
  const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(onContinue).not.toHaveBeenCalled();
});

it("shows the login step when Claude Code is installed but signed out", async () => {
  await show(states.signedOut);
  expect(screen.getByText("Installed (2.1.44 (Claude Code)).")).toBeTruthy();
  expect(screen.getByText(/aren't logged in/)).toBeTruthy();
  expect(screen.getByText(/run claude, and log in/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
});

it("enables Continue only when both checks pass", async () => {
  const onContinue = await show(states.ok);
  const rows = screen.getAllByRole("listitem");
  expect(rows.map(row => row.getAttribute("data-status"))).toEqual(["ok", "ok"]);
  const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onContinue).toHaveBeenCalledOnce();
});

it("reports a timeout and lets Re-check replace it with a pass", async () => {
  let result = states.timeout;
  const onContinue = vi.fn();
  render(<FirstLaunch check={() => Promise.resolve(result)} onContinue={onContinue} />);
  expect(await screen.findByText("The install check timed out.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  result = states.ok;
  fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(/timed out/)).toBeNull();
});

it("keeps the last result and shows an alert when a re-check throws", async () => {
  let fail = false;
  render(<FirstLaunch check={() => fail ? Promise.reject(new Error("still working")) : Promise.resolve(states.ok)} onContinue={vi.fn()} />);
  await screen.findByText(/You're logged in/);
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
  expect((await screen.findByRole("alert")).textContent).toContain("still working");
  expect(screen.getByText(/You're logged in/)).toBeTruthy();
});

it("uses no green/red, shows pending login as not checked, and copies the install command", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { container } = render(<FirstLaunch check={() => Promise.resolve(states.missing)} onContinue={vi.fn()} />);
  await screen.findByText("Claude Code isn't installed.");
  expect(container.innerHTML).not.toMatch(/#3dd68c|#ff6b6b/i);
  expect(screen.getAllByRole("listitem").map(r => r.getAttribute("data-status"))).toEqual(["fail", "pending"]);
  expect(screen.getByText(/Not checked yet\. We'll check the login/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("curl -fsSL https://claude.ai/install.sh | bash");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

it("lets a first-time user pick Codex and ignores an older Claude check", async () => {
  let finishClaude!: (result: LaunchChecks) => void;
  const check = vi.fn((provider: string) => provider === "claude"
    ? new Promise<LaunchChecks>(resolve => { finishClaude = resolve; })
    : Promise.resolve({ ...states.ok, version: "codex-cli 0.167.2" }));
  render(<FirstLaunch check={check} onContinue={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("AI provider"), { target: { value: "codex" } });
  expect(await screen.findByText("You're logged in to Codex.")).toBeTruthy();
  finishClaude(states.missing);
  await waitFor(() => expect(check).toHaveBeenCalledWith("codex"));
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  expect(localStorage.getItem("tangent.provider")).toBe("codex");
});
