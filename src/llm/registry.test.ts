import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getChoice, providers, selectedProvider, setChoice } from "./registry";
import { tauriProvider } from "./tauriProvider";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("out") }));
beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockClear(); });

it("tauriProvider invokes llm_complete with name, prompt, system, timeout", async () => {
  expect(await tauriProvider("codex").complete("hi", { system: "s", timeoutMs: 5 })).toBe("out");
  expect(invoke).toHaveBeenCalledWith("llm_complete", { provider: "codex", prompt: "hi", system: "s", timeoutMs: 5 });
});

it("tauriProvider forwards images only when present", async () => {
  await tauriProvider("claude").complete("look", { images: ["QUJD"] });
  expect(invoke).toHaveBeenCalledWith("llm_complete", { provider: "claude", prompt: "look", system: undefined, timeoutMs: undefined, images: ["QUJD"] });
  vi.mocked(invoke).mockClear();
  await tauriProvider("claude").complete("plain", { images: [] });
  expect(Object.keys(vi.mocked(invoke).mock.calls[0][1] as object)).not.toContain("images");
});

it("rejects without invoking when already aborted", async () => {
  const c = new AbortController(); c.abort();
  await expect(tauriProvider("claude").complete("x", { signal: c.signal })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("cancels the exact LLM request when its caller leaves", async () => {
  const c = new AbortController();
  let finish!: (value: string) => void;
  vi.mocked(invoke)
    .mockResolvedValueOnce(23)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const complete = tauriProvider("claude").complete("prompt", { signal: c.signal });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("llm_complete", expect.objectContaining({ requestId: 23 })));
  const rejected = expect(complete).rejects.toMatchObject({ name: "AbortError" });
  c.abort();
  expect(invoke).toHaveBeenCalledWith("cancel_request", { requestId: 23 });
  finish("late result");
  await rejected;
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "cancel_request")).toHaveLength(1);
});

it("defaults to Claude and persists recognized provider choices", () => {
  expect(Object.keys(providers)).toEqual(["claude", "codex", "agy"]);
  expect(getChoice()).toBe("claude");
  setChoice("codex");
  expect(getChoice()).toBe("codex");
  setChoice("agy");
  expect(getChoice()).toBe("agy");
  for (const invalid of ["bogus", "constructor", "__proto__"]) {
    localStorage.setItem("tangent.provider", invalid);
    expect(getChoice()).toBe("claude");
  }
});

it("uses the current provider through a handler created before Settings changes", async () => {
  await selectedProvider.complete("default");
  setChoice("codex");
  await selectedProvider.complete("script", { model: "sonnet", images: ["QUJD"] });
  expect(invoke).toHaveBeenCalledWith("llm_complete", expect.objectContaining({ provider: "claude", prompt: "default" }));
  expect(invoke).toHaveBeenCalledWith("llm_complete", expect.objectContaining({ provider: "codex", prompt: "script", model: "sonnet", images: ["QUJD"] }));
});
