import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getChoice, providers, setChoice } from "./registry";
import { tauriProvider } from "./tauriProvider";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("out") }));
beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockClear(); });

it("tauriProvider invokes llm_complete with name, prompt, system, timeout", async () => {
  expect(await tauriProvider("codex").complete("hi", { system: "s", timeoutMs: 5 })).toBe("out");
  expect(invoke).toHaveBeenCalledWith("llm_complete", { provider: "codex", prompt: "hi", system: "s", timeoutMs: 5 });
});

it("rejects without invoking when already aborted", async () => {
  const c = new AbortController(); c.abort();
  await expect(tauriProvider("claude").complete("x", { signal: c.signal })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("registry has claude and codex; choice defaults to claude and persists", () => {
  expect(Object.keys(providers)).toEqual(["claude", "codex"]);
  expect(getChoice()).toBe("claude");
  setChoice("codex");
  expect(getChoice()).toBe("codex");
  localStorage.setItem("tangent.provider", "bogus");
  expect(getChoice()).toBe("claude");
});
