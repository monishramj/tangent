import { describe, expect, it } from "vitest";
import heapify from "./fixtures/heapify.json";
import kokoro from "./fixtures/heapify.kokoro.json";
import { compile, DURATION, MIN_SEC, resolveAnchor, type BeatAudio, type Timeline } from "./compile";
import { Scene } from "./schema";
import { validateScene } from "./validate";

const scene = Scene.parse(heapify);
// beats[2] is the reaction: no audio.
const audio: (BeatAudio | undefined)[] = [kokoro[0], kokoro[1], undefined];
const PAUSE = 0.25;

// Fake aligner: one word per 0.2s slot, word takes 0.15s, 0.1s lead-in and tail.
const fakeAudio = (say: string): BeatAudio => {
  const words = say.split(/\s+/).map((word, i) => ({ word, start: 0.1 + i * 0.2, end: 0.25 + i * 0.2 }));
  return { words, duration: words[words.length - 1].end + 0.1 };
};
const oneBeat = (say: string, actions: unknown[]) =>
  Scene.parse({ scene: "t", objects: [{ id: "a", type: "text", text: "A" }, { id: "b", type: "text", text: "B" }], beats: [{ say, actions }] });

function checkInvariants(tl: Timeline, sc: Scene, au: (BeatAudio | undefined)[], pause: number) {
  for (const e of tl.events) {
    expect(e.start).toBeGreaterThanOrEqual(0);
    expect(e.end).toBeGreaterThanOrEqual(e.start);
    expect(e.end).toBeLessThanOrEqual(tl.totalSec + 1e-9);
  }
  const byTarget = new Map<string, Timeline["events"]>();
  for (const e of tl.events) if (e.target) byTarget.set(e.target, [...(byTarget.get(e.target) ?? []), e]);
  for (const evs of byTarget.values())
    for (let i = 1; i < evs.length; i++) expect(evs[i].start).toBeGreaterThanOrEqual(evs[i - 1].end - 1e-9); // monotonic, no overlap
  const speech = au.reduce((s, a) => s + (a?.duration ?? 0), 0);
  const reactions = tl.events.filter((e) => e.verb === "reaction").reduce((s, e) => s + e.end - e.start, 0);
  expect(tl.insertedSilences).toEqual([]); // never pads silence: the WAV is played as-is
  expect(tl.totalSec).toBeCloseTo(speech + reactions + pause * (sc.beats.length - 1), 9);
}

describe("resolveAnchor", () => {
  const words = kokoro[1].words;
  it.each([
    ["swaps", 3],
    ["SWAPS", 3],
    ["child", 7], // "child." punctuation-insensitive
    ["bigger child", 6],
    ["again one", 11], // "again," comma ignored
    ["swap", -1], // whole word only
    ["level up", -1],
  ])("%s -> %i", (at, want) => expect(resolveAnchor(words, at)).toBe(want));
});

describe("compile: heapify golden (real Kokoro alignment)", () => {
  it("fixture with spoken say text still validates", () => expect(validateScene(heapify)).toEqual([]));

  const tl = compile(scene, audio, PAUSE);
  const ev = (verb: string, target?: string) => tl.events.find((e) => e.verb === verb && e.target === target)!;

  it("anchors resolve to first-word start times; durations are verb defaults", () => {
    expect(ev("create", "title")).toMatchObject({ start: 0.302, beat: 0 });
    expect(ev("create", "title").end).toBeCloseTo(0.302 + DURATION.create, 9);
    expect(ev("create", "h").start).toBe(0.805);
    const hl = ev("highlight", "h.slot[0]");
    expect(hl.start).toBe(1.449); // "broken spot" -> "broken"
    expect(hl.args).toEqual({ color: "burgundy" });
  });

  it("beat 1 is offset by beat 0 audio + pause; op reserves the gap to beat end", () => {
    const b1 = 3.1 + PAUSE;
    const op = ev("op", "h");
    expect(op.start).toBeCloseTo(b1 + 0.842, 9);
    expect(op.end).toBeCloseTo(b1 + 5.275, 9);
    expect(op.args).toEqual({ op: "siftDown", args: [0] });
    expect(ev("transition")).toMatchObject({ beat: 1, args: { type: "cut" } });
    expect(ev("transition").start).toBeCloseTo(b1, 9);
    expect(ev("say").start).toBe(0);
  });

  it("reaction is a timed interstitial after the last speech beat", () => {
    const r = ev("reaction");
    expect(r.start).toBeCloseTo(3.1 + PAUSE + 5.275 + PAUSE, 9);
    expect(r.end - r.start).toBeLessThanOrEqual(2);
    expect(r).toMatchObject({ beat: 2, args: { intent: "satisfying click" } });
    expect(tl.events.filter((e) => e.verb === "say").map((e) => e.beat)).toEqual([0, 1]);
  });

  it("no silence needed; invariants hold", () => {
    expect(tl.insertedSilences).toEqual([]);
    checkInvariants(tl, scene, audio, PAUSE);
  });

  it("events are sorted by start", () => {
    const starts = tl.events.map((e) => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("compile: fitting motion without inserting silence", () => {
  const starts = (tl: Timeline, target: string) => tl.events.filter((e) => e.target === target).map((e) => e.start);
  const len = (tl: Timeline, target: string) => { const e = tl.events.find((e) => e.target === target)!; return e.end - e.start; };

  it("motion on another object may run past the next anchor; both start on their words", () => {
    // "two" -> "three" = 0.2s < create 0.4, but they touch different objects: keep the full 0.4.
    const sc = oneBeat("one two three four", [
      { at: "two", do: "create", target: "a" },
      { at: "three", do: "create", target: "b" },
    ]);
    const au = [fakeAudio("one two three four")];
    const tl = compile(sc, au, 0);
    expect(starts(tl, "a")).toEqual([au[0].words[1].start]);
    expect(starts(tl, "b")).toEqual([au[0].words[2].start]);
    expect(len(tl, "a")).toBeCloseTo(DURATION.create, 9);
    checkInvariants(tl, sc, au, 0);
  });

  it("the next anchor on the same object caps the motion (no overlap)", () => {
    const sc = oneBeat("one two three four", [
      { at: "two", do: "move", target: "a" },
      { at: "three", do: "fade", target: "a" },
    ]);
    const au = [fakeAudio("one two three four")];
    const tl = compile(sc, au, 0);
    expect(len(tl, "a")).toBeCloseTo(0.2, 9);
    checkInvariants(tl, sc, au, 0);
  });

  it("sub-objects count as the same object: h.slot[0] caps h", () => {
    const sc = Scene.parse({ scene: "t", objects: [{ id: "h", type: "Array", init: [1, 2] }],
      beats: [{ say: "one two three four", actions: [{ at: "two", do: "move", target: "h" }, { at: "three", do: "highlight", target: "h.slot[0]" }] }] });
    const tl = compile(sc, [fakeAudio("one two three four")], 0);
    expect(len(tl, "h")).toBeCloseTo(0.2, 9);
  });

  it("too little room even on its own object: compress to MIN_SEC, keep every word time, add no silence", () => {
    const say = "Go now. Then stop here";
    const sc = oneBeat(say, [
      { at: "now", do: "move", target: "a" },
      { at: "Then", do: "fade", target: "a" },
    ]);
    const au = [fakeAudio(say)];
    au[0].words[1].start += 0.12; // "now" -> "Then" gap 0.08 < MIN
    const tl = compile(sc, au, 0);
    const [move, fade] = tl.events.filter((e) => e.target === "a");
    expect(move.start).toBe(au[0].words[1].start);
    expect(move.end - move.start).toBeCloseTo(MIN_SEC, 9);
    expect(fade.start).toBe(au[0].words[2].start); // exactly on its word, not shifted
    expect(tl.totalSec).toBeCloseTo(au[0].duration, 9);
    expect(tl.insertedSilences).toEqual([]);
  });

  it("the last anchor uses the beat's trailing pause; motion never shifts the next beat", () => {
    const say = "one two three";
    const sc = Scene.parse({
      scene: "t",
      objects: [{ id: "a", type: "text", text: "A" }],
      beats: [{ say, actions: [{ at: "three", do: "move", target: "a" }] }, { say, actions: [] }],
    });
    const au = [fakeAudio(say), fakeAudio(say)];
    au[0] = { ...au[0], duration: 1.2 }; // "three" at 0.5, trailing pause up to 1.2: the full 0.5 move fits
    let tl = compile(sc, au, 0);
    expect(len(tl, "a")).toBeCloseTo(DURATION.move, 9);
    au[0] = { ...au[0], duration: 0.6 }; // only 0.1 left in the beat: compress to MIN, spilling into beat 1
    tl = compile(sc, au, 0.3);
    expect(len(tl, "a")).toBeCloseTo(MIN_SEC, 9);
    expect(tl.events.find((e) => e.verb === "say" && e.beat === 1)!.start).toBeCloseTo(0.6 + 0.3, 9);
    checkInvariants(tl, sc, au, 0.3);
  });

  it("motion at the very end of the scene is cut at the scene's end", () => {
    const sc = oneBeat("one two", [{ at: "two", do: "move", target: "a" }]);
    const au = [{ ...fakeAudio("one two"), duration: 0.35 }]; // "two" at 0.3
    const tl = compile(sc, au, 0);
    expect(tl.events.find((e) => e.target === "a")!.end).toBeCloseTo(0.35, 9);
    checkInvariants(tl, sc, au, 0);
  });

  it("actions sharing one anchor share the gap", () => {
    const sc = oneBeat("one two three four", [
      { at: "two", do: "create", target: "a" },
      { at: "two", do: "fade", target: "b" },
      { at: "four", do: "fade", target: "a", to: 0.2 },
    ]);
    const au = [fakeAudio("one two three four")];
    const tl = compile(sc, au, 0);
    // "two" at 0.3, next anchor "four" at 0.7: gap 0.4 fits create 0.4 and fade 0.3.
    const len = (verb: string, target: string) => {
      const e = tl.events.find((e) => e.verb === verb && e.target === target)!;
      return e.end - e.start;
    };
    expect(len("create", "a")).toBeCloseTo(DURATION.create, 9);
    expect(len("fade", "b")).toBeCloseTo(DURATION.fade, 9);
    expect(tl.insertedSilences).toEqual([]);
    expect(tl.events.find((e) => e.verb === "fade" && e.target === "a")!.args).toEqual({ to: 0.2 });
    checkInvariants(tl, sc, au, 0);
  });

  it("throws on missing audio or an anchor absent from the spoken words", () => {
    const sc = oneBeat("one two", [{ at: "two", do: "create", target: "a" }]);
    expect(() => compile(sc, [], 0)).toThrow(/audio/);
    expect(() => compile(sc, [fakeAudio("one three")], 0)).toThrow(/two/);
  });
});
