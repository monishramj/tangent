import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { checkAnnotations } from "./annotations";
import { ask, buildTutorContext, resumeTime } from "./tutor";

const objs = [{ id: "h", type: "Array", state: "[3,1,2]" }, { id: "t", type: "text" }];
const ctx = buildTutorContext({ objects: objs, transcript: "We swap the root", section: "Heaps", priorQuestions: ["why max?"] });
const mock = (...r: string[]) => {
  const complete = vi.fn(async () => r.shift() ?? "");
  return { p: { complete } as LLMProvider, complete };
};

describe("checkAnnotations", () => {
  it("keeps valid ids/slots, drops unknown or malformed", () => {
    const { ok, dropped } = checkAnnotations(
      [{ kind: "circle", target: "h.slot[0]" }, { kind: "arrow-to", target: "zz" }, { kind: "label", target: "t" }, { kind: "bogus", target: "h" }],
      ["h", "t"]);
    expect(ok).toHaveLength(1);
    expect(dropped).toHaveLength(3);
  });
});

describe("buildTutorContext", () => {
  it("includes ids, state, transcript, section, prior questions", () => {
    for (const s of ["h (Array)", "[3,1,2]", "We swap the root", "Heaps", "why max?"]) expect(ctx.prompt).toContain(s);
    expect(ctx.ids).toEqual(["h", "t"]);
  });
});

describe("ask", () => {
  const good = '{"answer":"It keeps the max on top.","annotations":[{"kind":"highlight","target":"h.slot[0]"},{"kind":"circle","target":"nope"}]}';
  it("parses, flags bad targets", async () => {
    const { p } = mock("```json\n" + good + "\n```");
    const r = await ask({ question: "why?", context: ctx, provider: p });
    expect(r.answer).toBe("It keeps the max on top.");
    expect(r.annotations).toEqual([{ kind: "highlight", target: "h.slot[0]" }]);
    expect(r.dropped).toHaveLength(1);
  });
  it("retries once on invalid JSON", async () => {
    const { p, complete } = mock("not json", good);
    expect((await ask({ question: "why?", context: ctx, provider: p })).answer).toContain("max");
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("throws after second failure", async () => {
    const { p, complete } = mock("x", "y");
    await expect(ask({ question: "q", context: ctx, provider: p })).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("resumeTime", () => {
  const starts = [0, 4, 9.5];
  it("snaps to current beat start", () => {
    expect(resumeTime(starts, 0)).toBe(0);
    expect(resumeTime(starts, 6.2)).toBe(4);
    expect(resumeTime(starts, 9.5)).toBe(9.5);
    expect(resumeTime(starts, 99)).toBe(9.5);
  });
  it("before first / empty", () => {
    expect(resumeTime(starts, -1)).toBe(0);
    expect(resumeTime([], 5)).toBe(0);
  });
});
