import { describe, expect, it } from "vitest";
import { expandTemplates, layers, shapeFor, TEMPLATES, VARIANTS, type TemplateName } from "./templates";
import { validateScene } from "./validate";

const say = "First the parent compares with both children, then the bigger child swaps up and we check again.";
const DATA: Record<TemplateName, unknown> = {
  title: { text: "Heapify", kicker: "CS 251", emoji: "🔥" },
  stat: { value: 42, suffix: "%", label: "faster lookups", icon: "rocket" },
  versus: { left: { title: "Array", icon: "list", points: ["fast index"] }, right: { title: "Linked list", icon: "link", points: ["cheap insert", "slow scan"] } },
  list: { title: "Heap rules", items: [{ text: "complete tree", at: "parent" }, { text: "parent is bigger", icon: "arrow-up" }, { text: "root is max" }] },
  character: { pose: "think", poseTo: "celebrate", says: "Wait, why?", other: { pose: "explain", says: "Order!" } },
  diagram: { title: "Datapath", nodes: [{ id: "pc", label: "PC" }, { id: "imem", label: "Instruction memory" }, { id: "alu", label: "ALU", at: "children" }, { id: "mux", label: "MUX" }],
    edges: [{ from: "pc", to: "imem" }, { from: "imem", to: "alu", label: "rs" }, { from: "alu", to: "mux" }, { from: "mux", to: "pc" }], pulse: [["pc", "imem"], ["imem", "alu"]] },
  math: { steps: ["T(n) = 2T(n/2) + n", "T(n) = n \\log n"], notes: [{ text: "two halves" }] },
  code: { title: "siftDown", lines: ["while i < n:", "  c = bigger(i)", "  swap(i, c)"], highlight: [[0, 0], [1, 2]] },
  array: { values: [3, 9, 7, 1, 4], label: "max-heap", ops: [{ op: "siftDown", args: [0], at: "swaps" }] },
  tree: { kind: "bst", init: [5, 3, 8], ops: [] },
  chart: { title: "Cost", labels: ["n", "n log n", "n²"], values: [1, 3, 9], highlight: 1 },
  figure: { src: "asset://fig1.png", caption: "Fig 4.12" },
  gif: { query: "mind blown", caption: "Linear time!" },
  callout: { text: "Swap with the bigger child", sub: "always" },
  table: { headers: ["op", "cost"], rows: [["insert", "log n"], ["peek", "1"]], highlightRows: [0] },
};

describe("templates", () => {
  for (const name of Object.keys(TEMPLATES) as TemplateName[]) for (const variant of VARIANTS[name]) it(`${name}/${variant} expands to a valid scene`, () => {
    const { scene, errors } = expandTemplates({ beats: [{ say: "Here we go.", template: "callout", data: { text: "Start" } }, { say, template: name, variant, data: DATA[name] }] });
    expect(errors).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
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
});
