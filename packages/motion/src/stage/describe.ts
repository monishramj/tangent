// What is ON SCREEN right now, as compact text for the tutor prompt (a cheap model can't see pixels reliably).
// Pure: (scene, applyEventsAt state) -> lines like `arr (Array): [9, 4, 7, 1, 3], slot 0 highlighted`.
import type { Scene, SceneObject, TreeNode } from "../dsl/schema";
import { fromLevel } from "../dsl/trees/shared";
import type { ObjState, SceneState } from "./scene";

const SEEN = 0.05; // opacity / highlight threshold
const MAX_LINE = 240;
const MAX_TOTAL = 4000;

const q = (s: string) => JSON.stringify(s.length > 80 ? s.slice(0, 79) + "…" : s);
const pt = (p: unknown) => typeof p === "string" ? p : Array.isArray(p) ? `(${p.map(n => Number(n).toFixed(2)).join(", ")})` : "?";
const onScreen = (s: ObjState | undefined) => !!s && s.visible && s.opacity > SEEN;

function treeKeys(o: Extract<SceneObject, { type: "Tree" }>): string {
  const root: TreeNode | null = Array.isArray(o.init) ? fromLevel(o.init as (number | null)[]) : (o.init as TreeNode | null);
  const out: string[] = [], queue: (TreeNode | null)[] = [root];
  while (queue.length) { // level order
    const n = queue.shift();
    if (!n) continue;
    out.push(n.keys.join("|"));
    queue.push(...n.children);
  }
  return out.join(", ");
}

/** The detail part of one object's line (everything after `id (type)`), plus its type tag. */
function detail(o: SceneObject, s: ObjState): { tag: string; info: string } {
  const hl = s.hl > SEEN ? "highlighted" : "";
  const parts = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(", ");
  const d = o as Record<string, unknown> & SceneObject;
  switch (o.type) {
    case "text": case "KineticText": return { tag: o.type, info: parts(q(o.text), hl) };
    case "Math": return { tag: "Math", info: parts(o.tex, hl) };
    case "shape": return { tag: `shape ${o.shape}`, info: parts(o.label && q(o.label), o.sublabel && q(o.sublabel), hl) };
    case "icon": return { tag: `icon ${o.name}`, info: parts(o.label && q(o.label), hl) };
    case "emoji": return { tag: `emoji ${o.char}`, info: parts(o.label && q(o.label), hl) };
    case "person": return { tag: `stick figure, pose ${s.pose ?? o.pose}`, info: parts(o.label && q(o.label), hl) };
    case "gif": return { tag: "reaction gif", info: parts(o.query && q(o.query), o.caption && `caption ${q(o.caption)}`) };
    case "chart": return { tag: `${o.kind} chart`, info: parts(o.labels.map((l, i) => `${l}=${o.values[i]}`).join(", "), hl) };
    case "counter": return { tag: "counter", info: parts(`${o.prefix ?? ""}${o.to}${o.suffix ?? ""}`, o.label && q(o.label)) };
    case "flow": return { tag: "flow", info: parts(`nodes ${o.nodes.map(n => q(n.label)).join(", ")}`,
      o.edges.length > 0 && `edges ${o.edges.map(e => `${e.from}→${e.to}${e.label ? ` ${q(e.label)}` : ""}`).join(", ")}`) };
    case "table": {
      const row = s.row ?? o.highlightRow;
      const rows = o.rows.map((r, i) => `${i === row ? "*" : ""}[${r.join(" | ")}]`).join(" ");
      return { tag: "table", info: parts(`[${o.headers.join(" | ")}] ${rows}`, row !== undefined && `row ${row} highlighted`) };
    }
    case "code": {
      const lines = o.lines.map((l, i) => `${i}: ${l.trim()}`).join(" / ");
      const r = s.range;
      return { tag: "code", info: parts(lines, r && (r[0] === r[1] ? `line ${r[0]} highlighted` : `lines ${r[0]}-${r[1]} highlighted`)) };
    }
    case "figure": return { tag: "figure", info: parts(o.src.split("/").pop() ?? o.src, typeof d.caption === "string" && q(d.caption)) };
    case "bits": return { tag: "bits", info: parts(o.bits, o.label && q(o.label)) };
    case "stack": return { tag: "stack", info: o.frames.map(f => `${f.label}: ${f.items.join(", ")}`).join(" / ") };
    case "arrow": case "line": return { tag: `${o.type} ${pt(o.from)}→${pt(o.to)}${o.label ? `, label ${q(o.label)}` : ""}`, info: parts(s.pulse !== undefined && "signal moving", hl) };
    case "axes": return { tag: "axes", info: `x ${o.x.join("..")}, y ${o.y.join("..")}` };
    case "plot": return { tag: "plot", info: `y = ${o.expr}` };
    case "media": return { tag: "media", info: o.src.split("/").pop() ?? o.src };
    case "Array": {
      const slots = s.slots ?? o.init.map(value => ({ value, hl: 0 }));
      const lit = slots.flatMap((x, i) => x.hl > SEEN ? [i] : []);
      return { tag: "Array", info: parts(`[${slots.map(x => x.value).join(", ")}]`, lit.length > 0 && `slot${lit.length > 1 ? "s" : ""} ${lit.join(", ")} highlighted`, hl) };
    }
    case "Tree": {
      const lit = Object.entries(s.valHl ?? {}).filter(([, v]) => v > SEEN).map(([k]) => k);
      return { tag: `Tree ${o.kind}`, info: parts(`keys in level order: ${treeKeys(o)}`, lit.length > 0 && `${lit.join(", ")} highlighted`, hl) };
    }
    default: return { tag: (o as { type: string }).type, info: hl };
  }
}

const cap = (s: string) => s.length > MAX_LINE ? s.slice(0, MAX_LINE - 1) + "…" : s;

/** Visible objects as `{ id, type, state }`, ready for the tutor's `buildTutorContext({ objects })`. */
export function visibleObjects(scene: Scene, state: SceneState): { id: string; type: string; state?: string }[] {
  return scene.objects.flatMap(o => {
    const s = state.objects.get(o.id);
    if (!onScreen(s)) return [];
    const { tag, info } = detail(o, s!);
    return [{ id: o.id, type: tag, ...(info ? { state: cap(info) } : {}) }];
  });
}

/** Compact multi-line description of what is on screen: one line per visible object. */
export function describeScene(scene: Scene, state: SceneState): string {
  const lines = visibleObjects(scene, state).map(o => cap(`${o.id} (${o.type})${o.state ? ": " + o.state : ""}`));
  if (state.reaction) lines.push(`(a reaction gif is playing: ${q(state.reaction)})`);
  let out = lines.length ? lines.join("\n") : "(nothing on screen)";
  if (out.length > MAX_TOTAL) out = out.slice(0, MAX_TOTAL - 1) + "…";
  return out;
}
