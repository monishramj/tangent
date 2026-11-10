// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { CLAUDE_BASE_ARGS, ClaudeCodeCLI, parseStreamResult, type Spawn } from "../llm/claudeCli";
import { validateScene } from "@motion/dsl/validate";
import { TEMPLATE_GUIDE, TemplateScene } from "@motion/dsl/templates";
import { checkTemplateScene, generateGroupScene, recentFor } from "./scene";

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
    expect(TEMPLATE_GUIDE.length).toBeLessThan(8500); // prompt budget
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
    const gif = (say: string) => ({ say, template: "gif" as const, data: { query: "traffic jam" } });
    expect(checkTemplateScene({ objects: [], beats: [gif(beats[0].say), gif(beats[1].say)] }, beats.slice(0, 2)).map(e => e.message)).toContain("no two gif beats in a row");
    expect(checkTemplateScene(fig, beats.slice(0, 1), [{ id: "f", caption: "", src: "y.png" }])[0].message).toContain("figure src");
    const dia = (say: string, variant: string) => ({ say, template: "diagram" as const, variant, data: {} });
    expect(checkTemplateScene({ objects: [], beats: [dia(beats[0].say, "flow-h"), dia(beats[1].say, "cycle")] }, beats.slice(0, 2)).map(e => e.message).join(" ")).toContain("at most one diagram");
  });
});

describe("variety across scenes", () => {
  it("rejects the previous scene's last two template+variants and a template on > half the beats", () => {
    const recent = [{ template: "title", variant: "slam" }, { template: "callout", variant: "underline" }];
    const msgs = checkTemplateScene(TemplateScene.parse(good), beats, [], recent).map(e => e.message).join(" ");
    expect(msgs).toContain("title/slam was just used");
    expect(msgs).toContain("callout/underline was just used");
    expect(checkTemplateScene(TemplateScene.parse(good), beats, [], [{ template: "title", variant: "punch" }])).toEqual([]);
    const heavy = { objects: [], beats: [good.beats[0], { ...good.beats[1], template: "title" as const, variant: "words", data: { text: "x" } }, good.beats[2]] };
    expect(checkTemplateScene(TemplateScene.parse(heavy), beats).map(e => e.message).join(" ")).toContain("more than half");
  });
  it("puts recent templates in the prompt and records what a scene used", async () => {
    const provider = mockProvider(JSON.stringify(good));
    const p1 = { ...plan }, r = await generateGroupScene({ beats, plan: p1, provider, recent: [{ template: "stat", variant: "side" }] });
    expect(provider.complete.mock.calls[0][0]).toContain("Recently used (avoid repeating; the last two are not allowed): stat/side");
    expect(r.used).toEqual([{ template: "title", variant: "slam" }, { template: "array", variant: "default" }, { template: "callout", variant: "underline" }]);
    expect(recentFor([p1], 2)).toEqual(r.used!.slice(-2));
    expect(provider.complete.mock.calls[0][0].length).toBeLessThan(13000);
  });
});

describe("ClaudeCodeCLI (injected spawn only)", () => {
  it("passes prompts through stdin without a shell and collects text output", async () => {
    const { child, spawn, provider } = fakeProcess();
    const prompt = "source $(do-not-execute)";
    const result = provider.complete(prompt, { system: "JSON only" });
    const [cmd, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { stdio: string; cwd: string; env: Record<string, string> }];
    expect(cmd).toBe("claude");
    expect(args).toEqual([...CLAUDE_BASE_ARGS, "--output-format", "text", "--system-prompt", "JSON only"]);
    const after = (f: string) => args[args.indexOf(f) + 1];
    expect(after("--model")).toBe("haiku");
    expect(after("--tools")).toBe("");
    expect(after("--setting-sources")).toBe("");
    expect(after("--disallowedTools")).toContain("Bash");
    for (const f of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) expect(args).toContain(f);
    expect(options.stdio).toBe("pipe");
    expect(options.cwd).toMatch(/tangent-llm-/);
    expect(options.cwd).not.toBe(process.cwd());
    expect(options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(child.stdin.read().toString()).toBe(prompt);
    child.stdout.write("hello");
    child.stdout.write(" world");
    child.emit("close", 0);
    await expect(result).resolves.toBe("hello world");
  });

  it("sends images as one stream-json message and returns the result event text", async () => {
    const { child, spawn, provider } = fakeProcess();
    const result = provider.complete("what is on screen?", { images: ["QUJD"] });
    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args.slice(args.indexOf("--input-format"), args.indexOf("--input-format") + 2)).toEqual(["--input-format", "stream-json"]);
    expect(args).toContain("--verbose");
    const msg = JSON.parse(child.stdin.read().toString());
    expect(msg.message.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
    expect(msg.message.content[1]).toEqual({ type: "text", text: "what is on screen?" });
    child.stdout.write('{"type":"system"}\n{"type":"result","subtype":"success","is_error":false,"result":"An ALU."}\n');
    child.emit("close", 0);
    await expect(result).resolves.toBe("An ALU.");
    expect(() => parseStreamResult('{"type":"result","subtype":"error_during_execution","is_error":true}')).toThrow();
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

