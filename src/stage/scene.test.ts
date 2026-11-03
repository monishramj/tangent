import { describe, expect, it } from "vitest";
import { scene, timeline } from "./demo";
import { applyEventsAt, HL_FADE } from "./scene";

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
    const s = at(0.1);
    expect([...s.objects.values()].every((o) => !o.visible && o.opacity === 0)).toBe(true);
  });

  it("title slams in: scaled up mid-create, settles to 1, then fully opaque", () => {
    const start = 0.302;
    const mid = at(start + 0.1).objects.get("title")!;
    expect(mid.visible).toBe(true);
    expect(mid.scale).toBeGreaterThan(1.1);
    const done = at(start + 0.5).objects.get("title")!;
    expect(done).toMatchObject({ scale: 1, opacity: 1 });
  });

  it("array appears at 'fixes' with the initial values", () => {
    expect(at(0.7).objects.get("h")!.visible).toBe(false);
    expect(at(0.9).objects.get("h")!.visible).toBe(true);
    expect(values(0.9)).toEqual([3, 9, 7, 1, 4]);
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
