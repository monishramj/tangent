import { compile, resolveAnchor, type BeatAudio } from "./compile";
import type { Action, Scene, SceneObject } from "./schema";

export type OpSteps = Action[][]; // each step runs concurrently; steps run in sequence
export type OpPlan = ReadonlyMap<Action, OpSteps>;
type Component = Extract<SceneObject, { type: "Array" | "Tree" }>;

// Array: swap/compare(i,j), set(i,value), siftDown/siftUp(i) on a numeric max-heap.
// Tree: BST insert/remove(value), rotateLeft/rotateRight(slot); duplicate inserts are no-ops.
export function expandOp(object: SceneObject, action: Action): { object: Component; steps: OpSteps } {
  if (action.do !== "op" || action.target !== object.id || (object.type !== "Array" && object.type !== "Tree"))
    throw new Error("op needs a matching Array or Tree target");
  const { op, args, at } = action;
  const steps: OpSteps = [];
  const slot = (i: number) => `${object.id}.slot[${i}]`;
  const emit = (verb: "highlight" | "move" | "transform", i: number, props = {}): Action =>
    ({ at, do: verb, target: slot(i), ...props });
  const count = (n: number) => { if (args.length !== n) throw new Error(`${op} expects ${n} arguments`); };
  const index = (x: unknown, length: number): number => {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x >= length) throw new Error(`${op}: invalid slot ${x}`);
    return x;
  };
  if (object.type === "Array") {
    const init = [...object.init];
    const highlight = (...indices: number[]) => steps.push([...new Set(indices)].map(i => emit("highlight", i)));
    const swap = (i: number, j: number) => {
      if (i === j) return;
      steps.push([emit("move", i, { to: slot(j), value: init[i] }), emit("move", j, { to: slot(i), value: init[j] })]);
      [init[i], init[j]] = [init[j], init[i]];
    };
    if (op === "swap" || op === "compare" || op === "set") {
      count(2);
      const i = index(args[0], init.length);
      if (op === "set") {
        const value = args[1];
        if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("set needs a number or string");
        init[i] = value;
        steps.push([emit("transform", i, { value })]);
      } else {
        const j = index(args[1], init.length);
        if (op === "compare") highlight(i, j);
        else swap(i, j);
      }
    } else if (op === "siftDown" || op === "siftUp") {
      count(1);
      let i = index(args[0], init.length);
      if (!init.every(v => typeof v === "number" && Number.isFinite(v))) throw new Error(`${op} needs numeric values`);
      const values = init as number[];
      if (op === "siftUp") {
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          highlight(parent, i);
          if (values[parent] >= values[i]) break;
          swap(parent, i);
          i = parent;
        }
      } else {
        while (2 * i + 1 < init.length) {
          const left = 2 * i + 1, right = left + 1;
          highlight(i, left, ...(right < init.length ? [right] : []));
          const child = right < init.length && values[right] > values[left] ? right : left;
          if (values[i] >= values[child]) break;
          swap(i, child);
          i = child;
        }
      }
    } else throw new Error(`unknown Array op: ${op}`);
    return { object: { ...object, init }, steps };
  }

  type Node = { value: number; from?: number; left: Node | null; right: Node | null };
  const read = (i: number): Node | null => object.init[i] == null ? null :
    { value: object.init[i]!, from: i, left: read(2 * i + 1), right: read(2 * i + 2) };
  let root = read(0);
  count(1);
  if (op === "insert" || op === "remove") {
    const value = args[0];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${op} needs a numeric value`);
    const edit = (node: Node | null, i: number, value: number): Node | null => {
      if (!node) return op === "insert" ? { value, left: null, right: null } : null;
      steps.push([emit("highlight", i)]);
      if (value < node.value) node.left = edit(node.left, 2 * i + 1, value);
      else if (value > node.value) node.right = edit(node.right, 2 * i + 2, value);
      else if (op === "remove") {
        if (!node.left) return node.right;
        if (!node.right) return node.left;
        let successor = node.right;
        while (successor.left) successor = successor.left;
        node.value = successor.value;
        node.from = successor.from;
        node.right = edit(node.right, 2 * i + 2, successor.value);
      }
      return node;
    };
    root = edit(root, 0, value);
  } else if (op === "rotateLeft" || op === "rotateRight") {
    const target = index(args[0], object.init.length);
    const rotate = (node: Node | null, i: number): Node | null => {
      if (!node) throw new Error(`${op}: empty slot ${target}`);
      if (i === target) {
        const pivot = op === "rotateLeft" ? node.right : node.left;
        if (!pivot) throw new Error(`${op}: missing child at slot ${target}`);
        steps.push([emit("highlight", i), emit("highlight", pivot.from!)]);
        if (op === "rotateLeft") { node.right = pivot.left; pivot.left = node; }
        else { node.left = pivot.right; pivot.right = node; }
        return pivot;
      }
      let child = target;
      while (Math.floor((child - 1) / 2) > i) child = Math.floor((child - 1) / 2);
      if (child === 2 * i + 1) node.left = rotate(node.left, child);
      else node.right = rotate(node.right, child);
      return node;
    };
    root = rotate(root, 0);
  } else throw new Error(`unknown Tree op: ${op}`);

  const init: (number | null)[] = [];
  const moves: Action[] = [];
  const write = (node: Node | null, i: number) => {
    if (!node) return;
    // shortcut: level-order trees need sparse padding; use a linked layout before supporting very deep trees.
    if (i > 1_000_000) throw new Error("Tree operation exceeds level-order layout capacity");
    while (init.length <= i) init.push(null);
    init[i] = node.value;
    if (node.from !== undefined && node.from !== i) moves.push(emit("move", node.from, { to: slot(i), value: node.value }));
    write(node.left, 2 * i + 1);
    write(node.right, 2 * i + 2);
  };
  write(root, 0);
  if (moves.length) steps.push(moves);
  if (init.length !== object.init.length || init.some((v, i) => v !== object.init[i]))
    steps.push([{ at, do: "transform", target: object.id, init }]);
  return { object: { ...object, init }, steps };
}

// Opt-in compiler entry point: the base compile() contract still exposes unexpanded ops.
export function compileOps(scene: Scene, audio: (BeatAudio | undefined)[], pause?: number) {
  const objects = new Map(scene.objects.map(o => [o.id, o]));
  const plan = new Map<Action, OpSteps>();
  scene.beats.forEach((beat, b) => {
    if (!("say" in beat)) return;
    const clip = audio[b];
    if (!clip) throw new Error(`no audio for beat ${b}`);
    const ordered = beat.actions.map(action => {
      const word = resolveAnchor(clip.words, action.at);
      if (word < 0) throw new Error(`beat ${b}: anchor "${action.at}" not in spoken words`);
      return { action, word };
    }).sort((a, b) => a.word - b.word);
    for (const { action } of ordered) {
      if (action.do !== "op") continue;
      if (!action.target) throw new Error("op needs a target");
      const object = objects.get(action.target);
      if (!object) throw new Error(`unknown op target: ${action.target}`);
      const expanded = expandOp(object, action);
      objects.set(object.id, expanded.object);
      plan.set(action, expanded.steps);
    }
  });
  return compile(scene, audio, pause, plan);
}
