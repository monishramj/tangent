import { describe, expect, it } from "vitest";
import { EXPAND, GUIDE, SAMPLES, TEMPLATES, VARIANTS, fillLevel, pictographGrid } from "./antigravity";
import { ctx } from "../tplkit";
import { Scene } from "../schema";
import { SAMPLE_SAY } from "../fixtures/samples";
import { validateScene } from "../validate";

it("computes fill, caps the liquid and preserves overflow", () => {
  expect(fillLevel(0, 10)).toEqual({ level: 0, overflow: 0, percent: 0 });
  expect(fillLevel(3, 10)).toEqual({ level: .3, overflow: 0, percent: 30 });
  expect(fillLevel(12, 10)).toEqual({ level: 1, overflow: 2, percent: 120 });
  expect(TEMPLATES.fill.safeParse({ label: "Bad", amount: -1, capacity: 0 }).success).toBe(false);
  expect(TEMPLATES.fill.safeParse({ label: "Huge", amount: 1e308, capacity: 1e-308 }).success).toBe(false);
});
it("fits every grid from one to one hundred without collisions", () => {
  for (let n = 1; n <= 100; n++) {
    const { cols, rows, cell } = pictographGrid(n);
    expect(cols * rows).toBeGreaterThanOrEqual(n);
    expect(cols * cell * 9 / 16).toBeLessThanOrEqual(.760001);
    expect(rows * cell).toBeLessThanOrEqual(.500001);
  }
  expect(TEMPLATES.pictograph.safeParse({ n: 10, k: 11, label: "Invalid" }).success).toBe(false);
});

describe("human template edge cases", () => {
  for (const name of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) for (const variant of VARIANTS[name]) it(`${name}/${variant} validates its own sample`, () => {
    const c = ctx(0, SAMPLE_SAY, new Set());
    const data = TEMPLATES[name].parse(SAMPLES[name]);
    (EXPAND[name] as (c: ReturnType<typeof ctx>, d: unknown, v: string) => void)(c, data, variant);
    const scene = Scene.parse({ scene: "test", objects: c.objects, beats: [{ say: SAMPLE_SAY, actions: c.actions }] });
    expect(validateScene(scene)).toEqual([]);
    expect(c.keyId).toBeDefined();
    expect(c.actions.some(a => ["move", "transform", "indicate"].includes((a as { do: string }).do) || (a as { style?: string }).style === "slide") || c.objects.some(o => o.type === "counter")).toBe(true);
  });
  it("keeps compact guidance", () => expect(GUIDE.length).toBeLessThanOrEqual(600));
  it("handles six long messages and six domino labels", () => {
    for (const name of ["chat", "dominoes"] as const) {
      const data = name === "chat" ? { left: { name: "A" }, right: { name: "B" }, messages: Array.from({ length: 6 }, (_, i) => ({ from: i % 2 ? "right" : "left", text: "Long label ".repeat(30), typing: true })) } : { items: Array.from({ length: 6 }, () => ({ text: "Long label ".repeat(30), emoji: "🔥" })) };
      for (const variant of VARIANTS[name]) {
        const c = ctx(0, SAMPLE_SAY, new Set());
        (EXPAND[name] as (c: ReturnType<typeof ctx>, d: unknown, v: string) => void)(c, TEMPLATES[name].parse(data), variant);
        for (const o of c.objects) {
          if (typeof o.x === "number") expect(o.x).toBeGreaterThanOrEqual(.05);
          if (typeof o.x === "number") expect(o.x).toBeLessThanOrEqual(.95);
          if (o.type === "shape" && o.label) expect(o.label.length).toBeLessThanOrEqual(90);
        }
        expect(validateScene(Scene.parse({ scene: "edge", objects: c.objects, beats: [{ say: SAMPLE_SAY, actions: c.actions }] }))).toEqual([]);
      }
    }
  });
});
