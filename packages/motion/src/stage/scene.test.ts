import { describe, expect, it } from "vitest";
import { scene, timeline } from "./demo";
import { applyEventsAt, HL_FADE } from "./scene";
import { Scene } from "../dsl/schema";

const at = (t: number) => applyEventsAt(scene, timeline, t);
const slots = (t: number) => at(t).objects.get("h")!.slots!;
const values = (t: number) => slots(t).map((s) => s.value);
const swapEvents = timeline.events.filter((e) => e.verb === "move" && e.target?.startsWith("h.slot"));

describe("applyEventsAt (heapify)", () => {
  it("is deterministic and seek-order independent", () => {
    const a = at(5);
    at(9); at(1);
    expect(at(5)).toEqual(a);
  });

  it("nothing visible before the first anchor", () => {
    const s = at(0.03);
    expect([...s.objects.values()].every((o) => !o.visible && o.opacity === 0)).toBe(true);
  });

  it("title slams in: scaled up mid-create, settles to 1, then fully opaque", () => {
    const start = 0.06;
    const mid = at(start + 0.1).objects.get("title")!;
    expect(mid.visible).toBe(true);
    expect(mid.scale).toBeGreaterThan(1.1);
    const done = at(start + 0.5).objects.get("title")!;
    expect(done).toMatchObject({ scale: 1, opacity: 1 });
  });

  it("array appears at 'fixes' with the initial values", () => {
    expect(at(0.5).objects.get("h")!.visible).toBe(false);
    expect(at(0.6).objects.get("h")!.visible).toBe(true);
    expect(values(0.6)).toEqual([3, 9, 7, 1, 4]);
  });

  it("slot 0 highlight pulses on 'broken', fades after", () => {
    expect(slots(1.45)[0].hl).toBe(1);
    expect(slots(1.45)[1].hl).toBe(0);
    const end = timeline.events.find((e) => e.verb === "highlight" && e.target === "h.slot[0]")!.end;
    expect(slots(end + HL_FADE / 2)[0].hl).toBeCloseTo(0.5, 5);
    expect(slots(end + HL_FADE + 0.01)[0].hl).toBe(0);
  });

  it("siftDown [3,9,7,1,4] swaps 3 and 9, then 3 and 4, landing values only when each move completes", () => {
    const first = swapEvents.find((e) => e.target === "h.slot[0]")!;
    const mid = (first.start + first.end) / 2;
    expect(values(mid)).toEqual([3, 9, 7, 1, 4]); // mid-move: values not yet landed
    expect(slots(mid)[0].to).toBe(1);
    expect(slots(mid)[0].p).toBeGreaterThan(0);
    expect(values(first.end + 1e-6)).toEqual([9, 3, 7, 1, 4]);
    expect(slots(first.end + 1e-6)[0].to).toBeUndefined();
    expect(values(timeline.totalSec)).toEqual([9, 4, 7, 1, 3]); // matches the script: "nine, four, seven, one, three"
  });

  it("reaction window carries the intent; ended by totalSec", () => {
    const r = timeline.events.find((e) => e.verb === "reaction")!;
    expect(at((r.start + r.end) / 2).reaction).toBe("satisfying click");
    expect(at(r.start - 0.01).reaction).toBeNull();
    expect(at(r.end + 0.01).reaction).toBeNull();
  });

  it("cut at beat 1 is a brief dip, then gone", () => {
    const tr = timeline.events.find((e) => e.verb === "transition")!;
    expect(at(tr.start + 0.01).transition).toMatchObject({ type: "cut" });
    expect(at(tr.start + 0.2).transition).toBeNull();
  });

  it("whip transition progresses 0..1 over its window", () => {
    const tl = { ...timeline, events: [{ start: 1, end: 1.3, verb: "transition" as const, args: { type: "whip" }, beat: 0 }] };
    const w = applyEventsAt(scene, tl, 1.15).transition!;
    expect(w.type).toBe("whip");
    expect(w.p).toBeCloseTo(0.5, 9);
    expect(applyEventsAt(scene, tl, 1.4).transition).toBeNull();
  });

  it("fade lowers opacity; move lerps position", () => {
    const tl = {
      ...timeline,
      events: [
        { start: 0, end: 0.4, verb: "create" as const, target: "title", args: {}, beat: 0 },
        { start: 1, end: 2, verb: "fade" as const, target: "title", args: { to: 0.2 }, beat: 0 },
        { start: 1, end: 2, verb: "move" as const, target: "title", args: { to: [0.1, 0.1] }, beat: 0 },
      ],
    };
    const mid = applyEventsAt(scene, tl, 1.5).objects.get("title")!;
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.opacity).toBeGreaterThan(0.2);
    const end = applyEventsAt(scene, tl, 3).objects.get("title")!;
    expect(end).toMatchObject({ opacity: 0.2, x: 0.1, y: 0.1 });
  });
});

describe("pulse, pose and kinetic variants", () => {
  const sc = Scene.parse({ scene: "x", objects: [
    { id: "a", type: "arrow", from: [.1, .5], to: [.9, .5] },
    { id: "p", type: "person", pose: "stand" },
    { id: "k", type: "KineticText", text: "HI", variant: "punch" },
    { id: "w", type: "KineticText", text: "A B C", variant: "words" },
  ], beats: [] });
  const ev = (verb: string, target: string, start: number, args = {}) => ({ start, end: start + 1, verb: verb as "create", target, args, beat: 0 });
  const tl = { totalSec: 5, insertedSilences: [], events: [ev("create", "a", 0), ev("create", "p", 0), ev("create", "k", 0), ev("create", "w", 0), ev("pulse", "a", 1), ev("pose", "p", 2, { to: "wave" })] };
  const st = (t: number) => applyEventsAt(sc, tl, t).objects;

  it("pulse progress exists only while the event runs", () => {
    expect(st(.9).get("a")!.pulse).toBeUndefined();
    expect(st(1.5).get("a")!.pulse).toBeCloseTo(.5);
    expect(st(2.5).get("a")!.pulse).toBeUndefined();
  });
  it("pose blends from the previous pose and then holds", () => {
    expect(st(1.5).get("p")).toMatchObject({ pose: "stand", poseP: 1 });
    expect(st(2.5).get("p")).toMatchObject({ pose: "wave", poseFrom: "stand" });
    expect(st(2.5).get("p")!.poseP).toBeGreaterThan(0);
    expect(st(2.5).get("p")!.poseP).toBeLessThan(1);
    expect(st(4).get("p")).toMatchObject({ pose: "wave", poseP: 1 });
  });
  it("punch starts big and settles; words reveal linearly", () => {
    expect(st(.1).get("k")!.scale).toBeGreaterThan(1.1);
    expect(st(1).get("k")!.scale).toBe(1);
    expect(st(.5).get("w")!.reveal).toBeCloseTo(.5);
  });
});

describe("whip/push carry the cleared frame out", () => {
  const sc = Scene.parse({ scene: "t", objects: [{ id: "old", type: "text", text: "old" }, { id: "new", type: "text", text: "new" }], beats: [] });
  const ev = (verb: string, start: number, end: number, target?: string, args = {}) => ({ start, end, verb: verb as "create", target, args, beat: 0 });
  const tl = (type: string) => ({ totalSec: 5, insertedSilences: [], events: [
    ev("create", 0, .4, "old"), ev("transition", 1, 1.3, undefined, { type }), ev("fade", 1, 1.01, "old", { to: 0 }), ev("create", 1, 1.4, "new"),
  ] });
  const o = (type: string, t: number, id: string) => applyEventsAt(sc, tl(type), t).objects.get(id)!;
  it.each(["whip", "push"])("%s: old stays visible and leaves left while new arrives from the right; seek-stable", (type) => {
    expect(o(type, 1.15, "old").opacity).toBeGreaterThan(0);
    expect(o(type, 1.15, "old").x).toBeLessThan(.5);
    expect(o(type, 1.15, "new").x).toBeGreaterThan(.5);
    expect(o(type, 1.35, "old").opacity).toBe(0);
    expect(o(type, 1.35, "new").x).toBeCloseTo(.5);
    expect(o(type, 1.15, "old")).toEqual(o(type, 1.15, "old"));
  });
  it("cut swaps instantly", () => {
    expect(o("cut", 1.02, "old").opacity).toBe(0);
    expect(o("cut", 1.02, "new").x).toBeCloseTo(.5);
  });
});
