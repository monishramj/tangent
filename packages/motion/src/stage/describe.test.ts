import { describe, expect, it } from "vitest";
import { expandTemplates } from "../dsl/templates";
import { compileOps } from "../dsl/ops";
import { Scene } from "../dsl/schema";
import { applyEventsAt } from "./scene";
import { describeScene, visibleObjects } from "./describe";

const say = "First the parent compares with both children, then the bigger child swaps up and we check again.";
/** Template beats -> scene + timeline with fake word timings (0.3 s per word), like the dev Showcase. */
function build(beats: { template: string; variant?: string; data: unknown }[]) {
  const { scene, errors } = expandTemplates({ beats: beats.map(b => ({ say, ...b })) });
  if (!scene) throw new Error(JSON.stringify(errors));
  const s = Scene.parse(scene);
  const audio = s.beats.map(() => {
    const words = say.split(/\s+/).map((word, i) => ({ word, start: i * .3, end: i * .3 + .25 }));
    return { words, duration: words.length * .3 };
  });
  const tl = compileOps(s, audio, 0);
  const sayStarts = tl.events.filter(e => e.verb === "say").map(e => e.start);
  return { scene: s, tl, at: (t: number) => applyEventsAt(s, tl, t), sayStarts };
}

describe("describeScene", () => {
  it("describes a computed array after its op, with values from slots", () => {
    const { scene, tl, at } = build([{ template: "array", data: { values: [3, 9, 7, 1, 4], label: "max-heap", ops: [{ op: "siftDown", args: [0], at: "swaps" }] } }]);
    const d = describeScene(scene, at(tl.totalSec));
    expect(d).toMatch(/\(Array\): \[9, 4, 7, 1, 3\]/);
    expect(d).toContain("max-heap");
  });

  it("describes a diagram: shapes with labels and labelled arrows by endpoints", () => {
    const { scene, tl, at } = build([{ template: "diagram", data: {
      title: "Datapath", nodes: [{ id: "pc", label: "PC" }, { id: "imem", label: "Instruction memory" }, { id: "alu", label: "ALU" }],
      edges: [{ from: "pc", to: "imem", label: "addr" }, { from: "imem", to: "alu" }] } }]);
    const d = describeScene(scene, at(tl.totalSec));
    expect(d).toMatch(/\(shape [a-z]+\): "ALU"/);
    expect(d).toMatch(/\(arrow \S+→\S+, label "addr"\)/);
    expect(d).toContain('"Datapath"');
  });

  it("only lists what is visible: a cleared frame disappears, the new one shows", () => {
    const { scene, at, sayStarts } = build([
      { template: "callout", data: { text: "Swap with the bigger child" } },
      { template: "character", data: { pose: "think", says: "Wait, why?" } },
    ]);
    const first = describeScene(scene, at(sayStarts[1] - .05));
    expect(first).toContain("Swap with the bigger child");
    expect(first).not.toContain("stick figure");
    const second = describeScene(scene, at(sayStarts[1] + 3));
    expect(second).not.toContain("Swap with the bigger child");
    expect(second).toMatch(/stick figure, pose \w+/);
    expect(describeScene(scene, at(-1))).toBe("(nothing on screen)");
  });

  it("covers math, code with highlighted range, chart values and table rows", () => {
    const checks: [unknown, RegExp][] = [
      [{ template: "math", data: { steps: ["T(n) = n \\log n"] } }, /\(Math\): T\(n\) = n \\log n/],
      [{ template: "code", data: { title: "siftDown", lines: ["while i < n:", "  c = bigger(i)"], highlight: [[1, 1]] } }, /\(code\): 0: while i < n: \/ 1: c = bigger\(i\), line 1 highlighted/],
      [{ template: "chart", data: { title: "Cost", labels: ["n", "n log n"], values: [1, 3] } }, /chart\): n=1, n log n=3/],
      [{ template: "table", data: { headers: ["op", "cost"], rows: [["insert", "log n"], ["peek", "1"]], highlightRows: [0] } }, /\(table\): \[op \| cost\] .*\[insert \| log n\]/],
    ];
    for (const [beat, re] of checks) {
      const { scene, tl, at } = build([beat as { template: string; data: unknown }]);
      const hl = tl.events.find(e => e.verb === "highlight"); // look while a highlight is live
      expect(describeScene(scene, at(hl ? (hl.start + hl.end) / 2 : tl.totalSec))).toMatch(re);
    }
  });

  it("visibleObjects gives ids ready for annotation targets", () => {
    const { scene, tl, at } = build([{ template: "array", data: { values: [1, 2, 3] } }]);
    const objs = visibleObjects(scene, at(tl.totalSec));
    expect(objs.find(o => o.type === "Array")?.state).toBe("[1, 2, 3]");
    expect(objs.every(o => scene.objects.some(s => s.id === o.id))).toBe(true);
  });
});
