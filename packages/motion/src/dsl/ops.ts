import { compile, resolveAnchor, type BeatAudio } from "./compile";
import type { Action, Scene, SceneObject } from "./schema";
import { TREE_OPS } from "./treeOps";
import { Trace } from "./trees/shared";

export type OpSteps = Action[][]; // each step runs concurrently; steps run in sequence
export type OpPlan = ReadonlyMap<Action, OpSteps>;
type Component = Extract<SceneObject, { type: "Array" | "Tree" }>;

// Array sift direction and Tree kind come from the component options.
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
      const better = (a: number, b: number) => object.heap === "min" ? a < b : a > b;
      if (op === "siftUp") {
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          highlight(parent, i);
          if (!better(values[i], values[parent])) break;
          swap(parent, i);
          i = parent;
        }
      } else {
        while (2 * i + 1 < init.length) {
          const left = 2 * i + 1, right = left + 1;
          highlight(i, left, ...(right < init.length ? [right] : []));
          const child = right < init.length && better(values[right], values[left]) ? right : left;
          if (!better(values[child], values[i])) break;
          swap(i, child);
          i = child;
        }
      }
    } else throw new Error(`unknown Array op: ${op}`);
    return { object: { ...object, init }, steps };
  }

  const ops = TREE_OPS[object.kind];
  const handler = ops && Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : undefined;
  if (!handler) throw new Error(`unknown ${object.kind} Tree op: ${op}`);
  const trace = new Trace(object, at);
  handler(trace, args);
  return trace.finish();
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
