import { describe, expect, it } from "vitest";
import { compileOps, expandOp } from "./ops";
import { MIN_SEC, type BeatAudio } from "./compile";
import { Action, Scene, SceneObject } from "./schema";
import heapify from "./fixtures/heapify.json";
import alba from "./fixtures/heapify.alba.json";

const array = (init: (number | string)[]) => SceneObject.parse({ id: "h", type: "Array", init });
const tree = (init: (number | null)[]) => SceneObject.parse({ id: "h", type: "Tree", init });
const op = (name: string, args: unknown[]) => Action.parse({ at: "go", do: "op", target: "h", op: name, args });
const run = (object: SceneObject, name: string, args: unknown[]) => expandOp(object, op(name, args));

describe("expandOp", () => {
  it("computes heapify without mutating inputs, highlights comparisons and moves both values", () => {
    const object = array([3, 9, 7, 1, 4]);
    const before = structuredClone(object);
    const result = run(object, "siftDown", [0]);
    expect(result.object.init).toEqual([9, 4, 7, 1, 3]);
    expect(object).toEqual(before);
    expect(result.steps.flat().some(a => a.do === "highlight")).toBe(true);
    expect(result.steps.flat().filter(a => a.do === "move").map(a => [a.target, a.to])).toEqual([
      ["h.slot[0]", "h.slot[1]"], ["h.slot[1]", "h.slot[0]"],
      ["h.slot[1]", "h.slot[4]"], ["h.slot[4]", "h.slot[1]"],
    ]);
  });

  it.each([
    ["swap", [0, 2], [7, 9, 3]],
    ["set", [1, "nine"], [3, "nine", 7]],
    ["compare", [0, 1], [3, 9, 7]],
    ["siftUp", [2], [7, 9, 3]],
    ["siftDown", [2], [3, 9, 7]],
    ["swap", [1, 1], [3, 9, 7]],
  ])("Array %s", (name, args, want) => {
    expect(run(array([3, 9, 7]), name, args).object.init).toEqual(want);
  });

  it("sifts through ties and a lone left child, and compares strings without coercion", () => {
    expect(run(array([1, 5, 5, 4]), "siftDown", [0]).object.init).toEqual([5, 4, 5, 1]);
    expect(run(array([9, 8, 7]), "siftDown", [0]).object.init).toEqual([9, 8, 7]);
    expect(run(array(["b", "a"]), "swap", [0, 1]).object.init).toEqual(["a", "b"]);
  });

  it.each([
    ["insert", [6], [4, 2, 7, null, null, 6]],
    ["insert", [4], [4, 2, 7]],
    ["remove", [4], [7, 2]],
    ["remove", [99], [4, 2, 7]],
    ["rotateLeft", [0], [7, 4, null, 2]],
    ["rotateRight", [0], [2, null, 4, null, null, null, 7]],
  ])("Tree %s", (name, args, want) => {
    const object = tree([4, 2, 7]);
    const before = structuredClone(object);
    expect(run(object, name, args).object.init).toEqual(want);
    expect(object).toEqual(before);
  });

  it("handles empty trees, subtree rotations, and deletion with a successor's right child", () => {
    expect(run(tree([]), "insert", [3]).object.init).toEqual([3]);
    expect(run(tree([3]), "remove", [3]).object.init).toEqual([]);
    expect(run(tree([8, 4, 10, 2, 6]), "rotateLeft", [1]).object.init).toEqual([8, 6, 10, 4, null, null, null, 2]);
    expect(run(tree([4, 2, 8, null, null, 6, 9, null, null, null, null, null, 7]), "remove", [4]).object.init)
      .toEqual([6, 2, 8, null, null, 7, 9]);
  });

  it.each([
    ["swap", [-1, 0]], ["swap", [0, 3]], ["swap", [0.5, 1]], ["swap", [0]],
    ["compare", [0, 1, 2]], ["set", [0, null]], ["siftDown", [0, "min"]], ["unknown", []],
  ])("rejects invalid Array %s arguments %j", (name, args) => {
    expect(() => run(array([1, 2, 3]), name, args)).toThrow();
  });

  it("rejects unsupported targets, nonnumeric heaps, and invalid Tree operations", () => {
    expect(() => run(array(["a"]), "siftDown", [0])).toThrow();
    expect(() => run(tree([4, 2]), "rotateLeft", [0])).toThrow();
    expect(() => run(tree([4]), "insert", ["4"])).toThrow();
    expect(() => run(tree([4]), "swap", [0, 0])).toThrow();
    expect(() => expandOp(array([1]), { ...op("swap", [0, 0]), target: "other" })).toThrow();
    expect(() => expandOp(SceneObject.parse({ id: "h", type: "text", text: "hi" }), op("swap", [0, 0]))).toThrow();
  });
});

describe("compileOps", () => {
  it("expands the real fixture at the spoken anchor, preserving the source scene", () => {
    const scene = Scene.parse(heapify);
    const before = structuredClone(scene);
    const tl = compileOps(scene, [alba[0], alba[1], undefined]);
    const steps = tl.events.filter(e => e.beat === 1 && e.target);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0].start).toBeCloseTo(2.56 + 0.25 + 0.603);
    expect(tl.events.some(e => e.verb === "op")).toBe(false);
    expect(tl.insertedSilences).toEqual([]);
    expect(scene).toEqual(before);
  });

  it("compresses into short gaps without silence, keeps words aligned, and carries state in anchor order across beats and fades", () => {
    const scene = Scene.parse({ scene: "t", objects: [array([3, 9, 7, 1, 4])], beats: [
      { say: "go. next", actions: [
        { at: "next", do: "op", target: "h", op: "swap", args: [0, 4] },
        op("siftDown", [0]),
      ] },
      { say: "fade go", actions: [
        { at: "fade", do: "fade", target: "h" }, op("siftDown", [0]),
      ] },
    ] });
    const audio: BeatAudio[] = [
      { words: [{ word: "go.", start: 0.1, end: 0.12 }, { word: "next", start: 0.14, end: 0.2 }], duration: 0.3 },
      { words: [{ word: "fade", start: 0, end: 0.1 }, { word: "go", start: 0.4, end: 0.6 }], duration: 2 },
    ];
    const tl = compileOps(scene, audio, 0);
    expect(tl.insertedSilences).toEqual([]);
    const moves = tl.events.filter(e => e.verb === "move");
    expect(moves.every(e => e.end - e.start >= MIN_SEC - 1e-9)).toBe(true);
    expect(moves.find(e => e.args.value === 9 && e.args.to === "h.slot[4]")?.start).toBeCloseTo(0.14); // on its word
    expect(moves.some(e => e.beat === 1 && e.args.value === 3)).toBe(true);
    expect(tl.events.find(e => e.verb === "fade")?.args).toEqual({});
    expect(tl.totalSec).toBeCloseTo(2.3);
    for (const e of tl.events) expect(e.end).toBeLessThanOrEqual(tl.totalSec + 1e-9);
  });

  it("reports missing audio and missing word anchors", () => {
    const scene = Scene.parse({ scene: "t", objects: [array([1])], beats: [{ say: "go", actions: [op("set", [0, 2])] }] });
    expect(() => compileOps(scene, [])).toThrow(/audio/);
    expect(() => compileOps(scene, [{ words: [], duration: 1 }])).toThrow(/anchor/);
  });
});
