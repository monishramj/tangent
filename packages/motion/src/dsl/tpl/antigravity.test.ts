import { describe, expect, it } from "vitest";
import { EXPAND, GUIDE, SAMPLES, TEMPLATES, VARIANTS, chatLayout, dominoLayout, dominoStages, overlaps, pictographGrid, slab } from "./antigravity";
import { ctx } from "../tplkit";
import { Scene } from "../schema";
import { SAMPLE_SAY } from "../fixtures/samples";
import { validateScene } from "../validate";

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
it("dominoes lean on the next one without cutting through it, and the row stays on the stage", () => {
  for (const grow of [false, true]) for (let n = 3; n <= 6; n++) {
    const { P, W, H, X, S } = dominoLayout(n, grow), stages = dominoStages(P, W, H);
    expect(X - .21 * S * 9 / 16).toBeGreaterThanOrEqual(.05); // the figure's raised arms
    expect(P[n - 1] + H[n - 1]).toBeLessThanOrEqual(.95); // the last one lying flat
    stages.forEach((a, k) => {
      expect(a[k]).toBeGreaterThan(.2); // it visibly tips
      for (let j = 0; j + 1 < n; j++) expect(overlaps(slab(P[j], W[j], H[j], a[j]), slab(P[j + 1], W[j + 1], H[j + 1], a[j + 1]))).toBe(false);
      if (k) a.forEach((x, j) => expect(x).toBeGreaterThanOrEqual(stages[k - 1][j] - 1e-9)); // nothing tips back
    });
    expect(stages[n - 1][n - 1]).toBeCloseTo(Math.PI / 2);
    stages[n - 1].slice(0, -1).forEach(a => expect(a).toBeLessThan(Math.PI / 2));
  }
  expect(overlaps(slab(0, .1, 1, 0), slab(.05, .1, 1, 0))).toBe(true);
});
it("chat bubbles hug their text and the thread fits its room", () => {
  const L = chatLayout(["Hi", "Long label ".repeat(30), "ok", "Long label ".repeat(30), "a", "b"], .26, .77, .028);
  expect(L.items[0].w).toBeLessThan(L.items[1].w);
  expect(L.items[1].text.split("\n").length).toBeLessThanOrEqual(4);
  expect(L.total).toBeLessThanOrEqual(.77 + 1e-9);
  for (const b of L.items) expect(b.w).toBeLessThanOrEqual(.26 * .78 + .01);
});

it("keeps the six stress labels whole within three word-wrapped lines", async () => {
  const { dominoLabel } = await import("./antigravity");
  const labels = ["Off-by-one index in the loop", "Wrong row returned", "Cache stores bad data", "Every reader gets it", "Alerts fire everywhere at once", "Full site outage for an hour"];
  for (const variant of ["row", "grow"]) {
    const c = ctx(0, SAMPLE_SAY, new Set());
    EXPAND.dominoes(c, { items: labels.map(text => ({ text })) }, variant);
    const rendered = c.objects.filter(o => o.type === "text" && o.id.startsWith("dom_label"));
    rendered.forEach((o, i) => {
      if (o.type !== "text") throw new Error("missing label");
      expect(o.text.replace(/\n/g, " ")).toBe(labels[i]);
      expect(o.text.split("\n").length).toBeLessThanOrEqual(3);
    });
  }
  const long = dominoLabel("one two three four five six seven eight nine ten eleven twelve thirteen fourteen", 15);
  expect(long.split("\n")).toHaveLength(3);
  expect(long).toMatch(/…$/);
  expect(long.split("\n")[2]).toBe("seven eight…");
});
