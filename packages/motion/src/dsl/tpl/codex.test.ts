import { describe, expect, it } from "vitest";
import { TEMPLATES, VARIANTS, SAMPLES, EXPAND, GUIDE, scaleAngle, weightStack, logCost, raceProgress, gaugeAngle } from "./codex";
import { ctx } from "../tplkit";
import { Scene } from "../schema";
import { validateScene } from "../validate";
import { compile } from "../compile";
import { applyEventsAt } from "../../stage/scene";
import { SAMPLE_SAY } from "../fixtures/samples";

const audio = { duration: 6, words: SAMPLE_SAY.split(/\s+/).map((word, i) => ({ word, start: i * .3, end: i * .3 + .25 })) };
function expand(name: keyof typeof TEMPLATES, data: unknown, variant = VARIANTS[name][0]) {
  const c = ctx(0, SAMPLE_SAY, new Set());
  (EXPAND[name] as (c: ReturnType<typeof ctx>, data: unknown, v: string) => void)(c, TEMPLATES[name].parse(data), variant);
  return Scene.parse({ scene: "test", objects: c.objects, beats: [{ say: SAMPLE_SAY, actions: c.actions }] });
}

describe("physical templates", () => {
  it("keeps the guide within its prompt budget", () => expect(GUIDE.length).toBeLessThanOrEqual(600));
  for (const name of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) for (const v of VARIANTS[name]) it(`${name}/${v} validates and visibly moves`, () => {
    const scene = expand(name, SAMPLES[name], v);
    expect(validateScene(scene)).toEqual([]);
    const timeline = compile(scene, [audio], 0), start = applyEventsAt(scene, timeline, 1.5), end = applyEventsAt(scene, timeline, 6);
    expect([...end.objects].some(([id, s]) => Math.hypot(s.x - start.objects.get(id)!.x, s.y - start.objects.get(id)!.y) > .02)).toBe(true);
  });
  it("computes signed, bounded tilts without overflowing", () => {
    expect(scaleAngle(0, 0)).toBe(0);
    expect(scaleAngle(5, 5)).toBe(0);
    expect(scaleAngle(0, 10)).toBe(.24);
    expect(scaleAngle(10, 0)).toBe(-.24);
    expect(scaleAngle(Number.MAX_VALUE, Number.MAX_VALUE / 2)).toBeCloseTo(-.08);
    expect(weightStack(0, 0)).toBe(0);
    expect(weightStack(.1, 100)).toBe(1);
    expect(weightStack(100, 100)).toBe(6);
  });
  it("keeps loaded pans vertical, in frame, and joined to the beam through the wobble", () => {
    const scene = expand("scale", { left: { label: "long ".repeat(30), weight: 0 }, right: { label: "heavy ".repeat(30), weight: 1e100 } }, "balance");
    const tl = compile(scene, [audio], 0);
    for (let t = 0; t <= 6; t += .1) {
      const state = applyEventsAt(scene, tl, t);
      for (const [id, s] of state.objects) {
        expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(1);
        expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(1);
        if (/pan|hanger|label/.test(id)) expect(s.rotation).toBe(0);
      }
      for (const i of [0, 1]) expect(state.objects.get(`pan${i}`)!.y - state.objects.get(`hinge${i}`)!.y).toBeCloseTo(.23);
    }
  });
  it("ranks real growth functions and leaves slow runners short of the finish", () => {
    const kinds = ["1", "log n", "n", "n log n", "n^2", "2^n"] as const;
    const costs = kinds.map(k => logCost(k, 16));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(logCost("2^n", 1e6)).toBe(1e6);
    expect(raceProgress([0, 2, 4])).toEqual([1, .5, .125]);
    expect(raceProgress([10, 10])).toEqual([1, 1]);
    const sc = expand("race", { runners: [{ label: "fast", time: 2 }, { label: "slow", time: 20 }] });
    const st = applyEventsAt(sc, compile(sc, [audio], 0), 6);
    expect(st.objects.get("runner0")!.x).toBeCloseTo(.83);
    expect(st.objects.get("runner1")!.x).toBeCloseTo(.406);
    expect(TEMPLATES.race.safeParse({ runners: [{ label: "a", time: 1, growth: "n" }, { label: "b", time: 2 }] }).success).toBe(false);
    expect(TEMPLATES.race.safeParse({ runners: [{ label: "a", time: 1 }, { label: "b", growth: "n" }] }).success).toBe(false);
  });
  it("maps and clamps gauge angles, retaining actual out-of-range values", () => {
    expect(gaugeAngle(-10, 0, 100)).toBe(Math.PI);
    expect(gaugeAngle(50, 0, 100)).toBe(Math.PI * 1.5);
    expect(gaugeAngle(120, 0, 100)).toBe(Math.PI * 2);
    const scene = expand("gauge", { label: "load", value: 150 });
    expect(scene.objects.find(o => o.type === "counter")).toMatchObject({ to: 150 });
    expect(scene.objects.find(o => o.id === "overflow")).toMatchObject({ text: "ABOVE RANGE" });
    const big = expand("gauge", { label: "large", value: 1234567890123, unit: "requests" }, "meter");
    expect(Number(big.objects.find(o => o.type === "counter")!.size)).toBeLessThan(.03);
    for (const data of [{ min: 10, max: 10 }, { zones: [{ to: 50, label: "a" }, { to: 40, label: "b" }] }, { zones: [{ to: 30, label: "a" }, { to: 90, label: "b" }] }])
      expect(TEMPLATES.gauge.safeParse({ label: "x", value: 5, ...data }).success).toBe(false);
  });
});
