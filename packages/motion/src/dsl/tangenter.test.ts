import { describe, expect, it } from "vitest";
import { expandTemplates, TEMPLATE_GUIDE, type TemplateName } from "./templates";
import { contentBoxes, overlaps } from "./tangenter";
import { SAMPLE_SAY as say, TEMPLATE_SAMPLES } from "./fixtures/samples";
import { Scene } from "./schema";
import { validateScene } from "./validate";
import { compileOps } from "./ops";
import { applyEventsAt } from "../stage/scene";

const audio = () => ({ words: say.split(/\s+/).map((word, i) => ({ word, start: i * .3, end: i * .3 + .25 })), duration: say.split(/\s+/).length * .3 });
const beat = (template: TemplateName) => ({ say, template, data: TEMPLATE_SAMPLES[template], tangenter: { pose: "point", poseTo: "think", at: "@0.5", says: "Watch this" } });

describe("Tangenter", () => {
  for (const template of ["title", "stat", "versus", "list", "diagram", "chart", "code"] as const) it(`${template}: keeps presenter and bubble clear of content, validates and compiles`, () => {
    const result = expandTemplates({ beats: [beat(template)] });
    expect(result.errors).toEqual([]);
    expect(validateScene(result.scene)).toEqual([]);
    const scene = Scene.parse(result.scene), presenter = scene.objects.find(o => o.type === "person" && o.tangenter);
    // Full versus panels reach both corners: safely omit rather than obscure them.
    if (template === "versus") { expect(presenter).toBeUndefined(); return; }
    expect(presenter).toBeDefined();
    const boxes = contentBoxes(scene.objects.filter(o => !o.id.startsWith("tangenter")));
    for (const box of boxes) expect(overlaps({ x: Number(presenter!.x), y: .835, w: .09, h: .3 }, box)).toBe(false);
    const bubble = scene.objects.find(o => o.id === "tangenter_bubble");
    if (bubble) for (const box of boxes) expect(overlaps({ x: Number(bubble.x), y: Number(bubble.y), w: .28, h: Number(bubble.height) + .035 }, box)).toBe(false);
    expect(compileOps(scene, [audio()], 0).events.length).toBeGreaterThan(0);
  });
  it("keeps one figure and its age through consecutive beats and a transition, then clears it", () => {
    const result = expandTemplates({ beats: [beat("title"), beat("stat"), { say, template: "title", data: TEMPLATE_SAMPLES.title }] });
    expect(validateScene(result.scene)).toEqual([]);
    const scene = Scene.parse(result.scene), tl = compileOps(scene, [audio(), audio(), audio()], 0);
    const people = scene.objects.filter(o => o.type === "person");
    expect(people).toHaveLength(1);
    const id = people[0].id, start = audio().duration;
    expect(tl.events.filter(e => e.target === id && e.verb === "create")).toHaveLength(1);
    expect(tl.events.filter(e => e.target === id && e.verb === "fade").map(e => e.beat)).toEqual([2]);
    const state = applyEventsAt(scene, tl, start + .1).objects.get(id)!;
    expect(state.opacity).toBe(1);
    expect(state.age).toBeCloseTo(start + .1);
    expect(state.x).toBe(.06);
    expect(applyEventsAt(scene, tl, start * 2 + .2).objects.get(id)!.opacity).toBe(0);
  });
  it("uses the free side, and skips crowded layouts and media beats", () => {
    const occupied = { id: "obstacle", type: "shape", shape: "rect", x: .09, y: .85, width: .2, height: .3 };
    const right = expandTemplates({ beats: [{ ...beat("title"), objects: [occupied] }] }).scene!;
    expect(right.objects.find(o => o.type === "person")?.x).toBe(.94);
    const crowded = expandTemplates({ beats: [{ ...beat("title"), objects: [{ ...occupied, x: .5, width: 1 }] }] }).scene!;
    expect(crowded.objects.some(o => o.type === "person")).toBe(false);
    for (const template of ["gif", "figure"] as const) expect(expandTemplates({ beats: [beat(template)] }).scene!.objects.some(o => o.type === "person")).toBe(false);
  });
  it("types a safely placed bubble and combines first-word pose changes", () => {
    const short = { say: "Hi", template: "title", data: { text: "Hi" }, tangenter: { pose: "point", poseTo: "wave", says: "Watch this", at: "Hi" } };
    const scene = expandTemplates({ beats: [short, short] }).scene!;
    expect(validateScene(scene)).toEqual([]);
    expect(scene.objects.some(o => o.id === "tangenter_bubble")).toBe(true);
    expect(scene.beats.flatMap(b => "actions" in b ? b.actions : []).some(a => a.do === "create" && a.style === "type" && a.target === "tangenter_words")).toBe(true);
  });
  it("rejects invalid poses and bounds the prompt", () => {
    expect(expandTemplates({ beats: [{ ...beat("title"), tangenter: { pose: "nope" } }] }).errors.length).toBeGreaterThan(0);
    expect(TEMPLATE_GUIDE.length).toBeLessThan(8500);
  });
});
