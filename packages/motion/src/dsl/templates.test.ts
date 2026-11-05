import { describe, expect, it } from "vitest";
import { expandTemplates, layers, shapeFor, TEMPLATES, VARIANTS, type TemplateName } from "./templates";
import { compileOps } from "./ops";
import { Scene } from "./schema";
import { validateScene } from "./validate";
import { SAMPLE_SAY, TEMPLATE_SAMPLES } from "./fixtures/samples";

const say = SAMPLE_SAY, DATA = TEMPLATE_SAMPLES;

describe("templates", () => {
  for (const name of Object.keys(TEMPLATES) as TemplateName[]) for (const variant of VARIANTS[name]) it(`${name}/${variant} expands to a valid scene`, () => {
    const { scene, errors } = expandTemplates({ beats: [{ say: "Here we go.", template: "callout", data: { text: "Start" } }, { say, template: name, variant, data: DATA[name] }] });
    expect(errors).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
    const parsed = Scene.parse(scene), audio = parsed.beats.map(b => {
      const words = ("say" in b ? b.say : "").split(/\s+/).map((word, i) => ({ word, start: i * .3, end: i * .3 + .25 }));
      return { words, duration: words.length * .3 };
    });
    expect(compileOps(parsed, audio, 0).events.length).toBeGreaterThan(0);
  });

  it("callout box sits behind its text (object order is draw order)", () => {
    const { scene } = expandTemplates({ beats: [{ say, template: "callout", variant: "box", data: { text: "Key idea" } }] });
    const ids = scene!.objects.map(o => o.id);
    expect(ids.indexOf("callout_box")).toBeLessThan(ids.indexOf("callout"));
  });

  it("clears the previous frame unless keep, and keep allows actions on old ids", () => {
    const { scene } = expandTemplates({ beats: [
      { say: "Look at this heap.", template: "array", data: { values: [3, 9, 7] } },
      { say: "Now sift the root down.", keep: true, actions: [{ at: "root", do: "op", target: "arr", op: "siftDown", args: [0] }] },
      { say: "Done, and fast.", template: "callout", data: { text: "Done" } },
    ] });
    expect(validateScene(scene)).toEqual([]);
    const fades = (b: number) => (scene!.beats[b] as { actions: { do: string }[] }).actions.filter(a => a.do === "fade");
    expect(fades(1)).toHaveLength(0);
    expect(fades(2).length).toBeGreaterThan(0);
    expect((scene!.beats[2] as { transition?: string }).transition).toBeDefined();
  });

  it("reports bad template data per beat", () => {
    const r = expandTemplates({ beats: [{ say: "x", template: "stat", data: { label: "no value" } }] });
    expect(r.scene).toBeNull();
    expect(r.errors[0].beat).toBe(0);
  });

  it("falls back to a fraction anchor when a phrase is missing or ambiguous", () => {
    const { scene } = expandTemplates({ beats: [{ say: "the cat and the dog", template: "list", variant: "column", data: { items: [{ text: "a", at: "the" }, { text: "b", at: "dog" }] } }] });
    const ats = (scene!.beats[0] as { actions: { at: string }[] }).actions.map(a => a.at);
    expect(ats).toContain("dog");
    expect(ats.some(a => a.startsWith("@"))).toBe(true);
  });

  it("layers a DAG and picks datapath shapes", () => {
    const L = layers([{ id: "a" }, { id: "b" }, { id: "c" }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]);
    expect([...L.pos.values()].map(p => p[0])).toEqual([0, 1, 2]);
    expect(shapeFor(undefined, "ALU")).toBe("alu");
    expect(shapeFor("decision", "x?")).toBe("diamond");
  });

  it("computes shown numbers in code: distribution area, matrix product", () => {
    const d = expandTemplates({ beats: [{ say, template: "distribution", variant: "shade", data: { kind: "normal", a: -1, b: 1 } }] }).scene!;
    expect(d.objects.find(o => o.type === "counter")).toMatchObject({ to: .683, decimals: 3 });
    const m = expandTemplates({ beats: [{ say, template: "matrix", variant: "multiply", data: { rows: [[1, 2], [3, 4]], vector: [5, 6] } }] }).scene!;
    expect(m.objects.find(o => o.id === "mat_out")).toMatchObject({ rows: [[17], [39]] });
  });

  it("rejects inconsistent course data per beat", () => {
    const bad = (template: string, data: unknown, variant?: string) => expandTemplates({ beats: [{ say, template, variant, data }] }).errors[0]?.message ?? "";
    expect(bad("encoding", { fields: [{ name: "op", bits: 6 }, { name: "x", bits: 10 }] })).toMatch(/sum to 16, need 32/);
    expect(bad("encoding", { word: 8, fields: [{ name: "op", bits: 2, value: 7 }, { name: "x", bits: 6 }] })).toMatch(/does not fit/);
    expect(bad("numberline", { min: 0, max: 5, points: [{ value: 9 }] })).toMatch(/outside/);
    expect(bad("stack", { values: [], ops: [{ op: "pop" }] })).toMatch(/empty/);
    expect(bad("matrix", { rows: [[1, 2]], vector: [1] }, "multiply")).toMatch(/vector needs 2 entries/);
  });

  it("pipeline schedule: one instruction per stage per cycle, stalls delay later ones", () => {
    const sc = expandTemplates({ beats: [{ say, template: "pipeline", variant: "diagram", data: { instructions: ["a", "b", "c"], stall: { instr: 1, cycles: 1 } } }] }).scene!;
    const cells = sc.objects.filter(o => o.id.startsWith("pipe_c")).map(o => [o.id.split("_")[1].slice(1), o.id.split("_")[2], (o as { label?: string }).label]);
    const byCycle = new Map<string, string[]>();
    for (const [, cyc, label] of cells) if (label !== "–") byCycle.set(cyc!, [...(byCycle.get(cyc!) ?? []), label!]);
    for (const labels of byCycle.values()) expect(new Set(labels).size).toBe(labels.length);
    expect(cells.filter(c => c[0] === "1").map(c => c[2])).toEqual(["IF", "–", "ID", "EX", "MEM", "WB"]);
  });

  it("beat extras: emphasis marks, texture behind, punchy energy, one accent", () => {
    const { scene, errors } = expandTemplates({ beats: [{ say, template: "callout", variant: "underline", data: { text: "Swap with the bigger child", sub: "always" },
      emphasis: [{ text: "bigger child", mark: "underline" }, { target: "callout_sub", mark: "circle" }], texture: "dots", energy: "punchy", accent: true }] });
    expect(errors).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
    expect(scene!.objects[0]).toMatchObject({ type: "texture", pattern: "dots" });
    expect(scene!.objects.filter(o => o.type === "mark").map(o => (o as { target: string }).target)).toEqual(["callout", "callout_sub"]);
    expect(scene!.objects.filter(o => o.color).map(o => o.id)).toEqual(["callout"]);
    const acts = (scene!.beats[0] as { actions: { do: string; duration?: number }[] }).actions;
    expect(acts.filter(a => a.do === "camera")).toHaveLength(2);
    expect(acts.find(a => a.do === "create")!.duration).toBeLessThan(.4);
    const miss = expandTemplates({ beats: [{ say, template: "callout", data: { text: "x" }, emphasis: [{ text: "nope", mark: "circle" }] }] });
    expect(miss.errors[0].message).toMatch(/no on-screen text/);
  });
});
