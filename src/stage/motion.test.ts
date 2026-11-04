import { describe, expect, it } from "vitest";
import { ease, progress, staggerProgress, pathPoint, tracePoints, focusAt } from "./motion";
import { applyEventsAt } from "./scene";
import { fitLabel } from "./layout";
import { Scene } from "../dsl/schema";
import { compile, type TimelineEvent } from "../dsl/compile";
import { validateScene } from "../dsl/validate";

const scene = Scene.parse({ scene: "motion", objects: [{ id: "a", type: "shape", shape: "rect", label: "CPU" }], beats: [] });
const event = (verb: TimelineEvent["verb"], args = {}, start = 0, end = 1): TimelineEvent => ({ verb, args, start, end, target: "a", beat: 0 });
const state = (t: number, events: TimelineEvent[]) => applyEventsAt(scene, { events, totalSec: 10, insertedSilences: [] }, t);
const obj = (t: number, events: TimelineEvent[]) => state(t, events).objects.get("a")!;

describe("motion math", () => {
  it("clamps progress, including instantaneous events", () => {
    expect([progress(-1, 0, 1), progress(.5, 0, 1), progress(2, 0, 1)]).toEqual([0, .5, 1]);
    expect(progress(0, 0, 0)).toBe(1);
  });
  it.each(["outCubic", "outBack", "inOutQuad"] as const)("%s has exact endpoints", name => {
    expect(ease(0, name)).toBe(0); expect(ease(1, name)).toBe(1);
  });
  it("back overshoots; stagger settles all children", () => {
    expect(ease(.7, "outBack")).toBeGreaterThan(1);
    expect(staggerProgress(.2, 0, 4, .15)).toBeGreaterThan(staggerProgress(.2, 3, 4, .15));
    for (let i = 0; i < 4; i++) expect(staggerProgress(1, i, 4, .15)).toBe(1);
  });
  it("follows polyline distance and an arc with exact endpoints", () => {
    expect(pathPoint([[0, 0], [1, 0], [1, 3]], .5)).toEqual([1, 1]);
    expect(pathPoint([[0, 0], [1, 0]], .5, .2)[1]).toBeCloseTo(-.2);
    expect(pathPoint([[0, 0], [1, 0]], 1, .2)).toEqual([1, 0]);
    expect(tracePoints([[0, 0], [1, 0], [1, 1]], .25)).toEqual([[0, 0], [.5, 0]]);
  });
});

describe("seekable rich animation state", () => {
  it.each(["draw", "pop", "type", "slide", "stagger"])("creates with %s and settles", style => {
    const events = [event("create", { style })];
    expect(obj(.5, events).reveal).toBeGreaterThan(0);
    expect(obj(1, events)).toMatchObject({ visible: true, opacity: 1, scale: 1, reveal: 1, x: .5, y: .5 });
  });
  it("defaults outlines to draw, supports type and slide direction", () => {
    expect(obj(.5, [event("create")]).style).toBe("draw");
    expect(obj(.5, [event("create", { style: "type" })]).reveal).toBe(.5);
    expect(obj(0, [event("create", { style: "slide", edge: "right" })]).x).toBeGreaterThan(1);
  });
  it("moves on paths, transforms scale/rotation/color, and eases camera", () => {
    const events = [event("create"), event("move", { path: [[.5, .5], [.8, .2]], arc: .1 }, 1, 2), event("transform", { scale: 2, rotate: 1, color: "#000000" }, 2, 3), event("camera", { x: .7, y: .4, zoom: 2, shake: .01 }, 3, 4)];
    expect(obj(2, events)).toMatchObject({ x: .8, y: .2 });
    expect(obj(3, events)).toMatchObject({ scale: 2, rotation: 1, color: 0 });
    expect(state(4, events).camera).toMatchObject({ x: .7, y: .4, zoom: 2, shake: 0 });
    expect(state(3.5, events).camera!.zoom).toBeGreaterThan(1);
    const a = state(2.5, events); state(4, events); state(.1, events); expect(state(2.5, events)).toEqual(a);
  });
  it("indicate produces a transient ring; highlights float deterministically", () => {
    const events = [event("create"), event("indicate", {}, 1, 2)];
    expect(obj(1.5, events).ring).toBeGreaterThan(0);
    expect(obj(3, events).ring).toBe(0);
    expect(obj(1.5, events).y).not.toBe(obj(1.6, events).y);
  });
});

it("fits very long labels and unbroken words inside the box", () => {
  const measure = (s: string, size: number) => s.length * size * .6;
  for (const text of ["a long label ".repeat(30), "x".repeat(200), "hello\nworld"]) {
    const fit = fitLabel(text, 30, 90, 40, measure);
    expect(fit.text.split("\n").length * fit.size * 1.15).toBeLessThanOrEqual(40);
    expect(Math.max(...fit.text.split("\n").map(l => measure(l, fit.size)))).toBeLessThanOrEqual(90);
  }
});

const visuals = [
  { id: "flow", type: "flow", nodes: [{ id: "cpu", label: "CPU" }, { id: "ram", label: "RAM" }], edges: [{ from: "cpu", to: "ram" }] },
  { id: "table", type: "table", headers: ["A", "B"], rows: [["1", "2"]], highlightRow: 0, highlightCol: 1 },
  { id: "code", type: "code", lines: ["add x1, x2, x3", "ret"], highlight: [[0, 0], [1, 1]] },
  { id: "figure", type: "figure", src: "/figure.png", focus: [[0, 0, .5, .5], [.5, .5, 1, 1]] },
  { id: "bits", type: "bits", bits: "010101", groups: [2, 4] },
  { id: "stack", type: "stack", frames: [{ label: "main", items: ["x = 3"] }] },
];
it.each(visuals)("validates and compiles $type", o => {
  const input = { scene: "visual", objects: [o], beats: [{ say: "Hello world", actions: [{ at: "Hello", do: "create", target: o.id, style: "stagger", gap: .1 }] }] };
  expect(validateScene(input)).toEqual([]);
  const tl = compile(Scene.parse(input), [{ duration: 2, words: [{ word: "Hello", start: 0, end: .5 }, { word: "world", start: 1, end: 2 }] }]);
  expect(tl.events.find(e => e.verb === "create")!.args).toMatchObject({ style: "stagger", gap: .1 });
});
it("rejects invalid animation and visual inputs", () => {
  for (const o of [ { ...visuals[0], edges: [{ from: "missing", to: "cpu" }] }, { ...visuals[1], rows: [["1"]] }, { ...visuals[2], highlight: [[3, 4]] }, { ...visuals[3], focus: [[.8, 0, .2, 1]] }, { ...visuals[4], bits: "012" }, { ...visuals[4], groups: [1] } ]) {
    expect(validateScene({ scene: "bad", objects: [o], beats: [] }).length).toBeGreaterThan(0);
  }
  expect(Scene.safeParse({ ...scene, beats: [{ say: "hi", actions: [{ at: "hi", do: "create", target: "a", style: "bad" }] }] }).success).toBe(false);
});
export { visuals };

it("interpolates figure focus boxes and clamps endpoints", () => {
  const boxes: [number, number, number, number][] = [[0, 0, .5, .5], [.5, .5, 1, 1]];
  expect(focusAt(boxes, 0)).toEqual(boxes[0]);
  expect(focusAt(boxes, .5)).toEqual([.25, .25, .75, .75]);
  expect(focusAt(boxes, 2)).toEqual(boxes[1]);
});
it("derives code highlights and figure motion from time, independently of seek order", () => {
  const scene = Scene.parse({ scene: "visual", objects: [visuals[2], visuals[3]], beats: [] });
  const events = scene.objects.map(o => ({ ...event("create"), target: o.id }));
  const timeline = { totalSec: 10, insertedSilences: [], events };
  const at = (t: number) => applyEventsAt(scene, timeline, t);
  expect(at(.5).objects.get("code")).toMatchObject({ style: "type", reveal: .5, range: [0, 0] });
  expect(at(7).objects.get("code")!.range).toEqual([1, 1]);
  expect(at(4).objects.get("figure")!.focus).toEqual([.25, .25, .75, .75]);
  const mid = at(3); at(9); at(0); expect(at(3)).toEqual(mid);
});
it("validates highlight selectors against their primitive", () => {
  const input = { scene: "visual", objects: [visuals[1]], beats: [{ say: "Hello then", actions: [{ at: "Hello", do: "create", target: "table" }, { at: "then", do: "highlight", target: "table", row: 10 }] }] };
  expect(validateScene(input).some(e => e.path.endsWith("row"))).toBe(true);
});
