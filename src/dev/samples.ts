// Dev showcase samples (mirrors templates.test.ts fixtures).
const say = "First the parent compares with both children, then the bigger child swaps up and we check again.";
const DATA = {
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
export const SAMPLES = Object.fromEntries(Object.entries(DATA).map(([k, data]) => [k, { say, data }])) as Record<keyof typeof DATA, { say: string; data: unknown }>;
