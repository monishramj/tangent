import type { Timeline } from "@motion/dsl/compile";
import { DEFAULT_GAP_SEC } from "@motion/player/queue";
import { isPhotoSource } from "@/gen/transcribe";
import { isOfficeSource } from "@/storage/library";
import type { BeatBoxes, Passage, RenderPage } from "@/follow/types";
import { pdfPage } from "@/home/api";
import Textbook from "./Textbook";
import TextSource from "./TextSource";

export type FollowSource = { id: string; pdfPath: string; pages: number[]; passages: Passage[] };
type Scene = { timeline: Timeline; sourceIds?: string[]; passageIds?: string[][]; passages?: BeatBoxes; scene: { beats: unknown[] } };

/** Source id of the spoken beat at t. Same clock as currentPassageIds. */
export function sourceIdAt(scenes: { timeline: Timeline; sourceIds?: string[] }[], t: number): string | undefined {
  let offset = 0;
  let id = "";
  for (const scene of scenes) {
    for (const event of scene.timeline.events) {
      if (event.verb === "say" && offset + event.start <= t + .01) id = scene.sourceIds?.[event.beat] ?? "";
    }
    offset += scene.timeline.totalSec + DEFAULT_GAP_SEC;
  }
  return id || undefined;
}

/** Textbook pages for a PDF source, source text for slides, Word, or a photo. Switches with the beat. */
export default function SourceFollow({ sources, scenes, time, renderPage = pdfPage }: {
  sources: FollowSource[]; scenes: Scene[]; time: number; renderPage?: RenderPage;
}) {
  const id = sourceIdAt(scenes, time) ?? sources[0]?.id;
  const src = sources.find(s => s.id === id) ?? sources[0];
  if (!src) return null;
  const view = scenes.map(s => ({
    ...s,
    passages: s.passages?.map((boxes, i) => s.sourceIds?.[i] === src.id ? boxes : []),
    passageIds: s.passageIds?.map((ids, i) => s.sourceIds?.[i] === src.id ? ids : []),
  }));
  const text = isOfficeSource(src.pdfPath) || isPhotoSource(src.pdfPath);
  return text
    ? <TextSource key={src.id} passages={src.passages} scenes={view} time={time} transcribed={isPhotoSource(src.pdfPath)} />
    : <Textbook key={src.id} source={{ pdfPath: src.pdfPath, pages: src.pages }} scenes={view} time={time} renderPage={renderPage} />;
}
