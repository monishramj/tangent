// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import heapify from "../dsl/fixtures/heapify.json";
import { Scene } from "../dsl/schema";
import { validateScene } from "../dsl/validate";
import type { LLMProvider } from "../llm/provider";
import { ClaudeCodeCLI, type Spawn } from "../llm/claudeCli";
import { generateScene } from "./scene";
import { measureSections } from "./metrics";

const section = readFileSync(new URL("../../spikes/tts/script.txt", import.meta.url), "utf8");
const json = JSON.stringify(heapify);
const mockProvider = (...responses: string[]) => ({
  complete: vi.fn<LLMProvider["complete"]>().mockImplementation(async () => responses.shift()!),
});

describe("generateScene", () => {
  it("accepts the golden fixture, strips fences and teaches the current DSL and speech rules", async () => {
    const provider = mockProvider("```json\n" + json + "\n```");
    const result = await generateScene({ section, provider });
    expect(result).toEqual({ scene: Scene.parse(heapify), attempts: 1, errors: [] });
    expect(validateScene(result.scene)).toEqual([]);
    const prompt = provider.complete.mock.calls[0][0];
    for (const text of [JSON.stringify(section), "Array", "KineticText", "siftDown", "exact substrings", "one idea per beat", "parentheticals", "define", "JSON only", "forced alignment"])
      expect(prompt).toContain(text);
  });

  it("retries by appending only validator errors to the unchanged prompt", async () => {
    const broken = structuredClone(heapify);
    broken.beats[1].actions![0].at = "rotates";
    const errors = validateScene(broken);
    const provider = mockProvider(JSON.stringify(broken), json);
    const result = await generateScene({ section, provider });
    expect(result).toEqual({ scene: Scene.parse(heapify), attempts: 2, errors: [errors] });
    expect(provider.complete.mock.calls[1][0]).toBe(provider.complete.mock.calls[0][0] + "\n\nValidator errors:\n" + JSON.stringify(errors));
  });

  it("caps invalid JSON/schema responses at three calls and preserves errors", async () => {
    const provider = mockProvider("not json", "{}", "null");
    const result = await generateScene({ section, provider });
    expect(result.scene).toBeNull();
    expect(result.attempts).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.flat().every(error => error.code === "schema")).toBe(true);
    expect(provider.complete).toHaveBeenCalledTimes(3);
    expect(provider.complete.mock.calls[2][0]).toBe(provider.complete.mock.calls[1][0] + "\n\nValidator errors:\n" + JSON.stringify(result.errors[1]));
  });

  it("does not retry transport errors", async () => {
    const provider = mockProvider();
    provider.complete.mockRejectedValue(new Error("offline"));
    await expect(generateScene({ section, provider })).rejects.toThrow("offline");
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});

it("measures final validity and attempts without calling a real model", async () => {
  const metrics = await measureSections({ sections: [section, section, section], provider: mockProvider(json, "{}", json, "{}", "{}", "{}") });
  expect(metrics).toMatchObject({ total: 3, valid: 2, validityRate: 2 / 3, totalAttempts: 6, averageAttempts: 2 });
  expect(metrics.results.map(result => result.attempts)).toEqual([1, 2, 3]);
  expect(await measureSections({ sections: [], provider: mockProvider() })).toMatchObject({ total: 0, valid: 0, validityRate: 0, totalAttempts: 0, averageAttempts: 0 });
});

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  const spawn = vi.fn(() => child) as unknown as ReturnType<typeof vi.fn<Spawn>>;
  return { child, spawn, provider: new ClaudeCodeCLI(spawn) };
}

afterEach(() => vi.useRealTimers());

describe("ClaudeCodeCLI (injected spawn only)", () => {
  it("passes prompts through stdin without a shell and collects text output", async () => {
    const { child, spawn, provider } = fakeProcess();
    const prompt = "source $(do-not-execute)";
    const result = provider.complete(prompt, { system: "JSON only" });
    expect(spawn).toHaveBeenCalledWith("claude", ["-p", "--output-format", "text", "--model", "haiku", "--system-prompt", "JSON only"], { stdio: "pipe" });
    expect(child.stdin.read().toString()).toBe(prompt);
    child.stdout.write("hello");
    child.stdout.write(" world");
    child.emit("close", 0);
    await expect(result).resolves.toBe("hello world");
  });

  it("rejects nonzero exits, spawn failures and stdin errors", async () => {
    for (const event of ["exit", "spawn", "stdin"]) {
      const { child, provider } = fakeProcess();
      const result = provider.complete("prompt");
      if (event === "exit") {
        child.stderr.write("login required");
        child.emit("close", 1);
      } else if (event === "spawn") child.emit("error", new Error("missing executable"));
      else child.stdin.emit("error", new Error("broken pipe"));
      await expect(result).rejects.toThrow(event === "exit" ? "login required" : event === "spawn" ? "missing executable" : "broken pipe");
    }
  });

  it("kills the process on timeout and abort", async () => {
    vi.useFakeTimers();
    const timed = fakeProcess();
    const timeout = timed.provider.complete("prompt", { timeoutMs: 10 });
    const check = expect(timeout).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(10);
    await check;
    expect(timed.child.kill).toHaveBeenCalled();
    const aborted = fakeProcess();
    const controller = new AbortController();
    const result = aborted.provider.complete("prompt", { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow(/abort/i);
    expect(aborted.child.kill).toHaveBeenCalled();
    await expect(aborted.provider.complete("prompt", { signal: controller.signal })).rejects.toThrow(/abort/i);
    expect(aborted.spawn).toHaveBeenCalledTimes(1);
  });
});
