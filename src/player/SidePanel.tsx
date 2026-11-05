import { useEffect, useRef, useState } from "react";
import { ArrowLeft02Icon, ArrowUp02Icon, Cancel01Icon, PinIcon, PlayIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import GlassSurface from "@/components/GlassSurface";
import ShinyText from "@/components/ShinyText";
import type { LLMProvider } from "@/llm/provider";
import type { Checkpoint } from "@/gen/checkpoints";
import type { JsonStore, Thread } from "@/storage/projects";
import type { Line } from "@/tutor/narration";
import CheckpointCard from "./CheckpointCard";

export type Tab = "ask" | "transcript" | "check";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const chip = "inline-flex min-h-10 items-center rounded-full border border-line px-3 text-xs text-subtle tabular-nums transition-colors hover:bg-fg/10 hover:text-fg";

type Props = {
  tab: Tab; onTab: (t: Tab) => void; onClose: () => void; time: number;
  lines: Line[]; threads: Thread[]; activeThread: string | null; onSelectThread: (id: string | null) => void;
  onSend: (q: string, threadId: string | null) => void; thinking: boolean;
  onSeek: (t: number) => void; onResume: (t: number) => void; onPinNote?: (text: string, t: number) => void;
  checkpoint: Checkpoint | null; checkpoints: Checkpoint[]; provider: LLMProvider; store: JsonStore; videoId?: string;
  onCheckpointDone: () => void; onAskAbout: (q: string) => void;
};

// Docked beside the video (never over it). Tinted glass, chat-style threads pinned to video moments.
export default function SidePanel(p: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabs: [Tab, string][] = [["ask", "Ask"], ["transcript", "Transcript"], ...(p.checkpoint ? [["check", "Check"] as [Tab, string]] : [])];
  return (
    <GlassSurface width="min(400px,40vw)" height="calc(100% - 1.5rem)" borderRadius={16} className="slide-in m-3 ml-0 shrink-0">
    <div role="dialog" aria-label="Side panel" className="flex size-full flex-col overflow-hidden rounded-2xl">
      <header className="flex items-center gap-1 p-2">
        <div role="tablist" className="flex gap-1 rounded-full border border-line p-1">
          {tabs.map(([t, label]) => <button key={t} role="tab" type="button" aria-selected={p.tab === t} onClick={() => p.onTab(t)}
            className={`h-10 rounded-full px-4 text-sm transition-colors ${p.tab === t ? "bg-fg/15 text-fg" : "text-muted hover:text-fg"}`}>{label}</button>)}
        </div>
        <button type="button" aria-label="Close panel" onClick={p.onClose} className="ml-auto grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg"><Icon icon={Cancel01Icon} size={18} /></button>
      </header>
      {p.tab === "ask" && <Ask {...p} />}
      {p.tab === "transcript" && <Transcript {...p} />}
      {p.tab === "check" && p.checkpoint && <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <CheckpointCard key={p.checkpoint.id} checkpoint={p.checkpoint} provider={p.provider} store={p.store} videoId={p.videoId} onDone={p.onCheckpointDone} onAskAbout={p.onAskAbout} />
      </div>}
    </div>
    </GlassSurface>
  );
}

function Ask({ threads, activeThread, onSelectThread, onSend, thinking, time, onSeek, onResume, onPinNote }: Props) {
  const thread = threads.find(t => t.id === activeThread);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [thread?.messages.length, thinking]);
  const [draft, setDraft] = useState("");
  const submit = () => { const q = draft.trim(); if (!q || thinking) return; setDraft(""); onSend(q, activeThread); };
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {thread ? (
          <div className="flex flex-col gap-3 pb-3">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="All questions" onClick={() => onSelectThread(null)} className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10"><Icon icon={ArrowLeft02Icon} size={18} /></button>
              <button type="button" className={chip} onClick={() => onSeek(thread.t)}>▶ {clock(thread.t)}</button>
            </div>
            {thread.messages.map((m, i) => (
              <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <p className={`max-w-[88%] rounded-2xl px-3 py-2 text-[15px] leading-snug ${m.role === "user" ? "bg-fg text-bg" : "border border-line bg-fg/5 text-fg"}`}>{m.text}</p>
                {m.role === "tutor" && <div className="flex gap-1">
                  {onPinNote && <button type="button" onClick={() => onPinNote(`Q: ${thread.messages[i - 1]?.text ?? thread.title}\nA: ${m.text}`, thread.t)} className={`${chip} flex items-center gap-1`}><Icon icon={PinIcon} size={12} />Pin to notes</button>}
                  {i === thread.messages.length - 1 && <button type="button" onClick={() => onResume(thread.t)} className={`${chip} flex items-center gap-1`}><Icon icon={PlayIcon} size={12} className="fill-current" />Resume</button>}
                </div>}
              </div>
            ))}
            {thinking && <p role="status" aria-label="Thinking" className="text-sm"><ShinyText text="Thinking…" color="rgba(255,255,255,.5)" shineColor="#fff" /></p>}
            <div ref={end} />
          </div>
        ) : threads.length ? (
          <ul aria-label="Questions" className="flex flex-col gap-2 pb-3">
            {threads.map(t => <li key={t.id}>
              <button type="button" onClick={() => onSelectThread(t.id)} className="flex min-h-12 w-full flex-col gap-1 rounded-2xl border border-line px-4 py-3 text-left">
                <span className="line-clamp-2 text-fg">{t.title}</span>
                <span className="text-xs text-subtle tabular-nums">{clock(t.t)} · {Math.ceil(t.messages.length / 2)} {t.messages.length > 2 ? "replies" : "reply"}</span>
              </button>
            </li>)}
          </ul>
        ) : <p className="pt-6 text-center text-sm text-subtle">Paused at {clock(time)}. Ask anything about this moment.<br />Your questions stay here as threads you can come back to.</p>}
      </div>
      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={e => { e.preventDefault(); submit(); }}>
        {thread && <button type="button" aria-label="New question" onClick={() => onSelectThread(null)} className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-fg/10 hover:text-fg"><Icon icon={PlusSignIcon} size={18} /></button>}
        <textarea aria-label={thread ? "Reply in thread" : "Ask about this moment"} rows={1} value={draft} autoFocus
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={thread ? "Follow up…" : "Why does the bigger child swap?"}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-bg/60 px-4 py-2.5 text-fg transition-colors placeholder:text-subtle focus-visible:border-fg/50" />
        <button type="submit" aria-label="Send" disabled={thinking || !draft.trim()} className="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-bg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"><Icon icon={ArrowUp02Icon} size={20} /></button>
      </form>
    </>
  );
}

function Transcript({ lines, threads, time, onSeek, onSelectThread, onTab }: Props) {
  const nowIdx = lines.reduce((k, l, i) => l.t <= time + .01 ? i : k, -1);
  const items = [...lines.map((l, i) => ({ t: l.t, line: l, i })), ...threads.map(th => ({ t: th.t + .001, thread: th }))].sort((a, b) => a.t - b.t);
  const now = useRef<HTMLButtonElement>(null);
  useEffect(() => { now.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [nowIdx]);
  if (!lines.length) return <p className="p-6 text-center text-sm text-subtle">The transcript fills in as scenes arrive.</p>;
  return (
    <ol aria-label="Transcript" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      {items.map((x, k) => "line" in x && x.line ? (
        <li key={k}><button ref={x.i === nowIdx ? now : undefined} type="button" aria-current={x.i === nowIdx} onClick={() => onSeek(x.line!.t)}
          className={`flex min-h-10 w-full gap-3 rounded-xl border border-transparent px-3 py-2 text-left ${x.i === nowIdx ? "bg-fg/10 text-fg" : x.i < nowIdx ? "text-muted" : "text-subtle"}`}>
          <span className="w-9 shrink-0 pt-0.5 text-xs tabular-nums">{clock(x.line.t)}</span><span>{x.line.say}</span>
        </button></li>
      ) : "thread" in x && x.thread ? (
        <li key={k} className="py-1 pl-12"><button type="button" onClick={() => { onSelectThread(x.thread!.id); onTab("ask"); }} className="min-h-10 w-full rounded-2xl border border-line px-4 py-2 text-left text-sm">
          <span className="text-xs text-subtle">You asked</span><span className="block text-fg">{x.thread.title}</span>
        </button></li>
      ) : null)}
    </ol>
  );
}
