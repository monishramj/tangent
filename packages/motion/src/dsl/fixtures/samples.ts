// One data sample per template (valid for every variant). Shared by templates.test.ts and the dev showcase.
import type { TemplateName } from "../templates";
import { SAMPLES as CODEX } from "../tpl/codex";
import { SAMPLES as AGY } from "../tpl/antigravity";
import { SAMPLES as CLAUDE } from "../tpl/claude";

export const SAMPLE_SAY = "First the parent compares with both children, then the bigger child swaps up and we check again.";
export const TEMPLATE_SAMPLES: Record<TemplateName, unknown> = {
  title: { text: "Heapify", kicker: "CS 251", emoji: "🔥" },
  stat: { value: 42, suffix: "%", label: "faster lookups", icon: "rocket" },
  versus: { left: { title: "Array", icon: "list", points: ["fast index"] }, right: { title: "Linked list", icon: "link", points: ["cheap insert", "slow scan"] } },
  list: { title: "Heap rules", items: [{ text: "complete tree", at: "parent" }, { text: "parent is bigger", icon: "arrow-up" }, { text: "root is max" }] },
  character: { pose: "think", poseTo: "celebrate", says: "Wait, why?", other: { pose: "explain", says: "Order!" } },
  diagram: { title: "Datapath", nodes: [{ id: "pc", label: "PC" }, { id: "imem", label: "Instruction memory", shape: "document" }, { id: "alu", label: "ALU", at: "children" }, { id: "mux", label: "MUX" }],
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
  timeline: { title: "Sorting through time", events: [{ date: "1945", text: "Merge sort", icon: "book" }, { date: "1959", text: "Shell sort" }, { date: "1961", text: "Quicksort", emoji: "⚡" }, { date: "2002", text: "Timsort", icon: "python" }] },
  definition: { term: "Heap", kind: "noun", meaning: "A complete binary tree where every parent beats its children", example: "a priority queue" },
  analogy: { left: { label: "Heap", icon: "hierarchy" }, right: { label: "Company org chart", icon: "user-group" }, relation: "is like", note: "the boss is always on top" },
  steps: { title: "Insert into a heap", steps: [{ text: "Add at the end", sub: "next free slot" }, { text: "Compare with parent", icon: "search" }, { text: "Swap up", sub: "if bigger" }, { text: "Stop at root" }] },
  procon: { title: "Binary heap", pros: ["O(log n) insert", "Array backed", "O(1) max"], cons: ["Slow search", "Not sorted"] },
  quote: { text: "Premature optimization is the root of all evil", by: "Donald Knuth" },
  hook: { question: "Why is the biggest always on top?", sub: "one rule does it", pose: "confused", emoji: "🤔" },
  checklist: { title: "Is it a heap?", items: [{ text: "Complete tree", at: "parent" }, { text: "Parent ≥ children", at: "children" }, { text: "Sorted left to right", done: false, at: "swaps" }] },
  numberline: { title: "Valid indices", min: 0, max: 10, points: [{ value: 3, label: "i", at: "parent" }], intervals: [{ from: 6, to: 9, label: "children", openTo: true, at: "children" }] },
  venn: { title: "Trees", sets: [{ label: "BST", items: ["ordered", "search"] }, { label: "Heap", items: ["max on top"] }], both: ["binary"] },
  matrix: { label: "rotate 90°", rows: [[0, -1], [1, 0]], vector: [2, 1], highlight: { row: 0, col: 1 } },
  distribution: { kind: "normal", mean: 0, sd: 1, a: -1, b: 1, label: "68% within one σ" },
  pipeline: { instructions: ["ADD X1,X2,X3", "SUB X4,X1,X5", "LDUR X6,[X7]"], stall: { instr: 1, cycles: 1 } },
  encoding: { instr: "ADD X9, X20, X21", fields: [{ name: "opcode", bits: 11, value: 1112 }, { name: "Rm", bits: 5, value: 21 }, { name: "shamt", bits: 6, value: 0 }, { name: "Rn", bits: 5, value: 20 }, { name: "Rd", bits: 5, value: 9 }] },
  stack: { label: "call stack", values: [3, 7], ops: [{ op: "push", args: [9], at: "parent" }, { op: "pop", args: [], at: "swaps" }, { op: "peek", args: [] }] },
  queue: { label: "print queue", values: ["A", "B"], ops: [{ op: "enqueue", args: ["C"], at: "parent" }, { op: "dequeue", args: [], at: "swaps" }] },
  linkedlist: { label: "list", values: [4, 8, 15], ops: [{ op: "insert", args: [1, 6], at: "parent" }, { op: "delete", args: [3], at: "swaps" }] },
  graph: { nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }, { id: "F" }], edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"], ["D", "F"], ["E", "F"]],
    ops: [{ op: "bfs", args: ["A"], at: "parent" }] },
  ...CODEX, ...AGY, ...CLAUDE,
};
