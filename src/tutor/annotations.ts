// Tutor annotation DSL: draw-on-the-live-scene marks. Targets are object ids or slots ("h.slot[0]").
import { z } from "zod";
import { parseTarget } from "../dsl/schema";

export const Annotation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), target: z.string() }),
  z.object({ kind: z.literal("highlight"), target: z.string() }),
  z.object({ kind: z.literal("arrow-to"), target: z.string() }),
  z.object({ kind: z.literal("label"), target: z.string(), text: z.string().min(1) }),
]);
export type Annotation = z.infer<typeof Annotation>;

/** Split raw model annotations into valid ones and dropped (malformed or target id not in the scene). */
export function checkAnnotations(raw: unknown[], ids: string[]) {
  const ok: Annotation[] = [];
  const dropped: { raw: unknown; reason: string }[] = [];
  for (const r of raw) {
    const p = Annotation.safeParse(r);
    if (!p.success) { dropped.push({ raw: r, reason: "invalid annotation" }); continue; }
    const t = parseTarget(p.data.target);
    if (!t || !ids.includes(t.id)) dropped.push({ raw: r, reason: `unknown target ${p.data.target}` });
    else ok.push(p.data);
  }
  return { ok, dropped };
}
