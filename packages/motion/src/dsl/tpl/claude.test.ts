import { describe, expect, it } from "vitest";
import { claimSize, icebergLayout, stampBox } from "./claude";
import { expandTemplates } from "../templates";
import { validateScene } from "../validate";
import { applyEventsAt } from "../../stage/scene";
import { compile } from "../compile";
import { Scene } from "../schema";

const timed = (scene: Scene) => compile(scene, scene.beats.map(b => {
  const words = ("say" in b ? b.say : "").split(/\s+/).map((word, i) => ({ word, start: i * .3, end: i * .3 + .25 }));
  return { words, duration: words.length * .3 };
}), 0);

describe("claude templates", () => {
  it("iceberg: every layer is inside the camera view when it lands; cutaway fits the frame", () => {
    for (const n of [1, 2, 3, 4]) {
      const pan = icebergLayout(n, "pan");
      pan.layers.forEach((l, i) => {
        expect(l.y + l.h / 2).toBeLessThanOrEqual(pan.cams[i] + .5 - .03);
        expect(l.y - l.h / 2).toBeGreaterThanOrEqual(pan.cams[i] - .5);
        if (i) expect(pan.cams[i]).toBeGreaterThanOrEqual(pan.cams[i - 1]); // the camera only goes down
      });
      const cut = icebergLayout(n, "cutaway");
      expect(cut.cams.every(y => y === .5)).toBe(true);
      cut.layers.forEach((l, i) => {
        expect(l.y + l.h / 2).toBeLessThanOrEqual(.96);
        expect(l.w).toBeLessThanOrEqual(.84);
        if (i) expect(l.y - l.h / 2).toBeGreaterThan(cut.layers[i - 1].y + l.h / 2); // no overlap
      });
      expect(cut.tip.y - cut.tip.h / 2).toBeGreaterThan(0);
    }
  });

  it("stamp: sizes are computed, the longest word fits; false-ish verdicts strike the claim", () => {
    expect(claimSize(20)).toBeGreaterThan(claimSize(100));
    expect(stampBox("WRONG", .15).w).toBeLessThan(.45);
    const one = (verdict: string) => expandTemplates({ beats: [{ say: "People say heaps are sorted, but that is a myth.", template: "stamp", data: { claim: "Heaps are sorted", verdict } }] }).scene!;
    expect(one("myth").objects.some(o => o.type === "mark")).toBe(true);
    expect(one("fact").objects.some(o => o.type === "mark")).toBe(false);
    const sc = one("myth");
    expect(sc.objects.find(o => o.id === "stamp_word")).toMatchObject({ text: "MYTH", color: "#ffb224" });
    expect((sc.beats[0] as { actions: { at: string; target?: string }[] }).actions.find(a => a.target === "stamp_word")!.at).toBe("myth");
  });

  it("anchors never collide on short or one-word narration", () => {
    for (const say of ["Myth.", "Myth busted now", "Flip it"]) for (const [template, data] of [
      ["stamp", { claim: "x", verdict: "myth", correction: "y" }], ["flipcard", { front: "q", back: "a", at: "Flip" }],
      ["iceberg", { top: { text: "t" }, below: [{ text: "a" }, { text: "b" }] }]] as const)
      for (const variant of ["card", "slam", "duo", "pan", "cutaway"]) {
        const r = expandTemplates({ beats: [{ say, template, variant, data }] });
        expect(r.errors).toEqual([]);
        expect(validateScene(r.scene)).toEqual([]);
      }
  });

  it("flipcard: the front shrinks to zero width, then the back grows in (engine: scaleX + flip style)", () => {
    const sc = Scene.parse(expandTemplates({ beats: [{ say: "So which child swaps up? The bigger child always wins.", template: "flipcard", variant: "card", data: { front: "Which?", back: "Bigger" } }] }).scene);
    const tl = timed(sc), flip = tl.events.find(e => e.target === "flip_back")!;
    const mid = applyEventsAt(sc, tl, flip.start + .1), end = applyEventsAt(sc, tl, flip.end + .01);
    expect(mid.objects.get("flip_back")!.opacity).toBe(0);
    expect(end.objects.get("flip_front")!.sx).toBeCloseTo(0);
    expect(end.objects.get("flip_back")!.sx).toBeCloseTo(1);
    expect(end.objects.get("flip_back")!.opacity).toBe(1);
  });

  it("stamp style: lands from big at its tilt", () => {
    const sc = Scene.parse(expandTemplates({ beats: [{ say: "People say heaps are sorted, but that is a myth.", template: "stamp", data: { claim: "Heaps are sorted", verdict: "myth" } }] }).scene);
    const tl = timed(sc), ev = tl.events.find(e => e.target === "stamp_word" && e.verb === "create")!;
    expect(applyEventsAt(sc, tl, ev.start + .02).objects.get("stamp_word")!.scale).toBeGreaterThan(1.8);
    const done = applyEventsAt(sc, tl, ev.end + .01).objects.get("stamp_word")!;
    expect(done.scale).toBeCloseTo(1);
    expect(done.rotation).toBeCloseTo(-.22);
  });
});
