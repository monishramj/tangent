import { TREE_OPS } from "./treeOps";
import { FRACTION_ANCHOR, Scene, parseTarget, type Action, type SceneObject } from "./schema";

export type ErrorCode =
  | "schema"
  | "duplicate-id"
  | "anchor-not-found"
  | "ambiguous-anchor"
  | "bad-target"
  | "unknown-target"
  | "not-created"
  | "conflict"
  | "unknown-op"
  | "slot-out-of-range";

// beat is set whenever the error is local to one beat, so the caller can regenerate just that beat.
export type DslError = { path: string; code: ErrorCode; message: string; beat?: number };

// Use the same kind registry as expansion so validation cannot accept another kind's ops.
const OPS: Record<string, string[]> = {
  Array: ["swap", "compare", "set", "siftDown", "siftUp"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Case-insensitive, whole-word.
const anchorRe = (at: string) => new RegExp(`(?<![\\w'])${escape(at)}(?![\\w'])`, "gi");

export function validateScene(json: unknown): DslError[] {
  const parsed = Scene.safeParse(json);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "") || "$",
      code: "schema",
      message: i.message,
      beat: i.path[0] === "beats" && typeof i.path[1] === "number" ? i.path[1] : undefined,
    }));

  const scene = parsed.data;
  const errs: DslError[] = [];
  const objs = new Map<string, SceneObject>();
  scene.objects.forEach((o, i) => {
    if (objs.has(o.id)) errs.push({ path: `objects[${i}].id`, code: "duplicate-id", message: `duplicate object id "${o.id}"` });
    else objs.set(o.id, o);
  });

  scene.objects.forEach((o, i) => {
    const bad = (field: string, message: string) => errs.push({ path: `objects[${i}].${field}`, code: "schema", message });
    if (o.type === "line" || o.type === "arrow") for (const field of ["from", "to"] as const) {
      const endpoint = o[field];
      if (typeof endpoint === "string" && !objs.has(endpoint)) bad(field, `unknown endpoint "${endpoint}"`);
    }
  });

  const created = new Set<string>();
  scene.beats.forEach((beat, b) => {
    if (!("say" in beat)) return;
    const err = (a: number, field: string, code: ErrorCode, message: string) =>
      errs.push({ path: `beats[${b}].actions[${a}].${field}`, code, message, beat: b });

    const placed: { a: number; act: Action; pos: number }[] = [];
    beat.actions.forEach((act, a) => {
      const frac = FRACTION_ANCHOR.test(act.at);
      const hits = frac ? [] : [...beat.say.matchAll(anchorRe(act.at))];
      const pos = frac ? Math.floor(Number(act.at.slice(1)) * Math.max(0, beat.say.length - 1)) : hits[0]?.index ?? -1;
      if (pos < 0) err(a, "at", "anchor-not-found", `anchor "${act.at}" is not a whole phrase in say: "${beat.say}"`);
      if (hits.length > 1) err(a, "at", "ambiguous-anchor", `anchor "${act.at}" occurs ${hits.length} times in say; use a longer phrase`);
      if (act.target === undefined) return; // camera/wait may be untargeted
      const t = parseTarget(act.target);
      if (!t) return err(a, "target", "bad-target", `malformed target "${act.target}" (want id, id.slot[i] or id.val(x))`);
      const o = objs.get(t.id);
      if (!o) return err(a, "target", "unknown-target", `no object with id "${t.id}"`);
      if (act.do === "highlight") {
        if (act.row !== undefined && (o.type !== "table" || act.row >= o.rows.length)) err(a, "row", "schema", "row highlight needs a valid table row");
        if (act.col !== undefined && !(o.type === "table" ? act.col < o.headers.length : o.type === "chart" && act.col < o.values.length)) err(a, "col", "schema", "column highlight needs a valid table column or chart bar");
        if (act.range && (o.type !== "code" || act.range[1] >= o.lines.length)) err(a, "range", "schema", "line highlight needs a valid code range");
      }
      if (act.do === "move" && typeof act.to === "string") {
        const dest = parseTarget(act.to);
        const object = dest && objs.get(dest.id);
        if (!object || (dest && "slot" in dest && (object.type !== "Array" || dest.slot >= object.init.length))) err(a, "to", "bad-target", "move destination must exist");
      }
      const ops = o.type === "Tree" ? Object.keys(TREE_OPS[o.kind]) : OPS[o.type];
      if (("slot" in t || "val" in t) && !ops)
        return err(a, "target", "bad-target", `"${t.id}" is a ${o.type}; slot/val addressing needs a computed component`);
      if ("slot" in t && o.type === "Array" && t.slot >= o.init.length)
        err(a, "target", "slot-out-of-range", `slot ${t.slot} out of range for "${t.id}" (length ${o.init.length})`);
      if (act.do === "op" && (!ops || "slot" in t || "val" in t || !ops.includes(act.op)))
        err(a, "op", "unknown-op", ops ? `${o.type} has no op "${act.op}" (has: ${ops.join(", ")})` : `op on non-component ${o.type} "${t.id}"`);
      if (pos >= 0) placed.push({ a, act, pos });
    });

    // Order by anchor; at the same word, creates go first.
    placed.sort((x, y) => x.pos - y.pos || Number(y.act.do === "create") - Number(x.act.do === "create"));
    const seen = new Set<string>();
    for (const { a, act, pos } of placed) {
      const id = parseTarget(act.target!)!.id;
      if (act.do === "create") created.add(id);
      else if (!created.has(id)) err(a, "target", "not-created", `"${id}" is used at "${act.at}" before it is created`);
      const key = `${pos}|${act.target}`;
      if (seen.has(key)) err(a, "at", "conflict", `two actions hit "${act.target}" at "${act.at}"`);
      seen.add(key);
    }
    // Creates with a bad anchor still count, so one broken beat doesn't cascade into later beats.
    for (const act of beat.actions) if (act.do === "create" && act.target) created.add(parseTarget(act.target)?.id ?? "");
  });
  return errs;
}
