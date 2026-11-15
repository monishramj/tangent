import { TRANSCRIPTION_LABEL } from "@/gen/transcribe";
import { useEffect, useReducer, useRef } from "react";
import { currentPassageIds } from "@/tutor/glue";
import { followReducer, initialFollow, showBackButton } from "@/follow/follow";
import type { Timeline } from "@motion/dsl/compile";

/** Source text for a document or transcribed photo video. The beat's passage ids are the highlight. */
export default function TextSource({ passages, scenes, time, transcribed = false }: {
  passages: { id: string; markdown: string }[];
  scenes: { timeline: Timeline; passageIds?: string[][] }[];
  time: number;
  transcribed?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, dispatch] = useReducer(followReducer, initialFollow);
  const ids = currentPassageIds(scenes, time);
  const active = new Set(ids);
  const key = ids.join("\0");
  useEffect(() => { dispatch({ type: "beat", beat: key ? [...key].reduce((h, c) => Math.imul(h, 33) + c.charCodeAt(0) | 0, 0) : -1, hasBoxes: ids.length > 0 }); }, [key, ids.length]);
  useEffect(() => {
    const id = key.split("\0")[0];
    if (!id || !follow.following) return;
    scroller.current?.querySelector<HTMLElement>(`[data-passage="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: follow.seq ? "smooth" : "auto" });
  }, [follow.seq, follow.following, key]);
  const stop = () => { if (ids.length) dispatch({ type: "userScroll" }); };
  return <div className="relative min-h-0 min-w-0 flex-1">
    <div ref={scroller} aria-label="Source text" tabIndex={0} className="h-full space-y-3 overflow-auto px-4 py-4 text-sm leading-6 whitespace-pre-wrap"
      onWheel={stop} onTouchMove={stop} onKeyDown={e => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) stop();
      }}>
      {transcribed && <p className="text-muted">{TRANSCRIPTION_LABEL}</p>}
      {!passages.length && <p className="text-muted">No source text for this video.</p>}
      {passages.map(p => <p key={p.id} data-passage={p.id} data-testid={active.has(p.id) ? "passage-highlight" : undefined}
        className={active.has(p.id) ? "rounded-md bg-fg/12 px-2 py-1 outline outline-1 outline-fg/40" : "px-2 py-1"}>{p.markdown}</p>)}
    </div>
    {showBackButton(follow, ids.length > 0) && <button type="button" onClick={() => dispatch({ type: "backToCurrent" })}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-fg/20 bg-bg px-4 py-2 text-sm text-fg shadow-lg">Back to current</button>}
  </div>;
}
