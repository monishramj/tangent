// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { ClaudeCodeCLI, type Spawn } from "../llm/claudeCli";
import { validateScene } from "@motion/dsl/validate";
import { checkTemplateScene, generateGroupScene } from "./scene";

const mockProvider = (...responses: string[]) => ({
  complete: vi.fn<LLMProvider["complete"]>().mockImplementation(async () => responses.shift()!),
});
const beats = [
  { say: "Meet the heap.", visualIntent: "title" },
  { say: "The parent swaps with its bigger child.", visualIntent: "array sift" },
  { say: "So the root is always the max.", visualIntent: "takeaway" },
];
const plan = { start: 0, count: 3, concept: "heaps", visualPlan: "" };
const good = { beats: [
  { say: beats[0].say, template: "title", variant: "slam", data: { text: "Heaps", emoji: "🌲" } },
  { say: beats[1].say, template: "array", data: { values: [3, 9, 7], ops: [{ op: "siftDown", args: [0], at: "swaps" }] } },
  { say: beats[2].say, template: "callout", variant: "underline", data: { text: "Root = max" } },
] };

describe("generateGroupScene", () => {
  it("expands a templated answer into a valid scene and teaches templates in the prompt", async () => {
    const provider = mockProvider("```json\n" + JSON.stringify(good) + "\n```");
    const r = await generateGroupScene({ beats, plan, provider });
    expect(r.attempts).toBe(1);
    expect(validateScene(r.scene)).toEqual([]);
    const p = provider.complete.mock.calls[0][0];
    for (const t of ["Code Report", "versus", "diagram", "datapath", "verbatim", "siftDown"]) expect(p).toContain(t);
  });

  it("retries once with the previous answer and errors", async () => {
    const bad = structuredClone(good); bad.beats[1].say = "changed";
    const provider = mockProvider(JSON.stringify(bad), JSON.stringify(good));
    const r = await generateGroupScene({ beats, plan, provider });
    expect(r.attempts).toBe(2);
    expect(r.errors[0][0].message).toContain("verbatim".slice(0, 0) + "say must match");
    expect(provider.complete.mock.calls[1][0]).toContain("Your previous answer");
  });

  it("gives up after two bad answers", async () => {
    const r = await generateGroupScene({ beats, plan, provider: mockProvider("nope", "{}") });
    expect(r.scene).toBeNull();
    expect(r.errors).toHaveLength(2);
  });

  it("quality gate: variety, gifs, figure srcs", () => {
    const same = { objects: [], beats: beats.map(b => ({ say: b.say, template: "callout" as const, variant: "box", data: { text: "x" } })) };
    const msgs = checkTemplateScene(same, beats).map(e => e.message).join(" ");
    expect(msgs).toContain("vary it");
    expect(msgs).toContain("at least 2 different templates");
    const fig = { objects: [], beats: [{ say: beats[0].say, template: "figure" as const, data: { src: "x.png" } }] };
    expect(checkTemplateScene(fig, beats.slice(0, 1), [{ id: "f", caption: "", src: "y.png" }])[0].message).toContain("figure src");
  });
});

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
function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  const spawn = vi.fn(() => child) as unknown as ReturnType<typeof vi.fn<Spawn>>;
  return { child, spawn, provider: new ClaudeCodeCLI(spawn) };
}

