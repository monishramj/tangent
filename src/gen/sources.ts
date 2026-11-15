import type { Passage } from "@/follow/types";

type Cited = { passages?: string[]; cite?: string; topic?: string };

/** Prefix passage ids with the source id when more than one source is in the video. One source stays as stored. */
export function tagPassages(parts: { id: string; passages: Passage[] }[]): Passage[] {
  if (parts.length < 2) return parts[0]?.passages ?? [];
  return parts.flatMap(p => p.passages.map(x => ({ ...x, id: `${p.id}/${x.id}` })));
}

const sourceOf = (passageId: string) => {
  const cut = passageId.lastIndexOf("/");
  return cut > 0 ? passageId.slice(0, cut) : "";
};

/** Source ids named by this beat's passage ids or cite (`sourceId/...`). */
export function citedSources(beat: Cited, ids: Set<string>): string[] {
  const from = [...new Set((beat.passages ?? []).map(sourceOf).filter(id => ids.has(id)))];
  if (from.length) return from;
  const cite = beat.cite?.split("/")[0];
  return cite && ids.has(cite) ? [cite] : [];
}

/** One source id for the follow panel: the first source this beat cites. */
export function beatSourceId(beat: Cited, ids: Set<string>): string | undefined {
  return citedSources(beat, ids)[0];
}

/** Per-beat source ids, aligned with beats. Absent unless at least one beat names a known source. */
export function sceneSourceIds(beats: Cited[], ids: string[]): string[] | undefined {
  if (ids.length < 2) return;
  const known = new Set(ids);
  const out = beats.map(b => beatSourceId(b, known) ?? "");
  return out.some(Boolean) ? out : undefined;
}

/** Numeric-gate text. One source uses the whole section. Several sources use only the ones this beat cites. */
export function groundingText(beat: Cited, fallback: string, sources?: { id: string; markdown: string }[]): string {
  if (!sources || sources.length < 2) return fallback;
  const ids = citedSources(beat, new Set(sources.map(s => s.id)));
  return ids.map(id => sources.find(s => s.id === id)?.markdown ?? "").join("\n");
}

/** Group beats that share a topic label. Without a topic on every beat, keep the given order. */
export function mergeByTopic<T extends { topic?: string } | object>(beats: T[]): { beats: T[]; note?: string } {
  const topics = beats.map(b => {
    const topic = "topic" in b ? b.topic : undefined;
    return typeof topic === "string" ? topic.trim() : "";
  });
  if (topics.some(t => !t)) return { beats, note: "kept source order; outline has no topic groups" };
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  beats.forEach((b, i) => {
    const t = topics[i];
    if (!groups.has(t)) { order.push(t); groups.set(t, []); }
    groups.get(t)!.push(b);
  });
  return order.length < 2 ? { beats } : { beats: order.flatMap(t => groups.get(t)!) };
}
