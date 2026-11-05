import { useState } from "react";
import ShinyText from "@/components/ShinyText";
import type { LLMProvider } from "@/llm/provider";
import { gradeAnswer, type Checkpoint, type Grade } from "@/gen/checkpoints";
import type { JsonStore } from "@/storage/projects";

export type CheckpointResult = { response: string; correct: boolean; at: number };
export const results = (s: JsonStore) => ({
  get: async (videoId: string) => (await s.read<Record<string, CheckpointResult>>(`checks-${videoId}`)) ?? {},
  async put(videoId: string, id: string, r: CheckpointResult) { await s.write(`checks-${videoId}`, { ...(await this.get(videoId)), [id]: r }); },
});

const btn = "flex min-h-11 items-center justify-center rounded-2xl border border-line px-4 text-fg active:scale-[.98]";

export default function CheckpointCard({ checkpoint: cp, provider, store, videoId, onDone, onAskAbout }: {
  checkpoint: Checkpoint; provider: LLMProvider; store: JsonStore; videoId?: string; onDone: () => void; onAskAbout: (q: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const submit = async (response: string) => {
    if (!response.trim() || grading || grade) return;
    setAnswer(response); setGrading(true);
    const g = await gradeAnswer(cp, response, provider);
    setGrade(g); setGrading(false);
    if (videoId) void results(store).put(videoId, cp.id, { response, correct: g.correct, at: Date.now() }).catch(() => {});
  };
  return (
    <section aria-label="Checkpoint" className="flex flex-col gap-4">
      <p className="text-xs text-subtle">{cp.source === "textbook" ? `From the textbook${cp.cite ? ` · ${cp.cite}` : ""}` : "Generated question"}</p>
      <h3 className="text-xl font-semibold leading-snug tracking-tight">{cp.prompt}</h3>
      {cp.kind === "mcq" ? (
        <div role="radiogroup" aria-label="Choices" className="flex flex-col gap-2">
          {cp.choices!.map(c => {
            const state = !grade ? "" : c === cp.answer ? "border-fg bg-fg text-bg" : c === answer ? "border-line opacity-60 line-through" : "opacity-50";
            return <button key={c} type="button" role="radio" aria-checked={answer === c} disabled={!!grade} onClick={() => void submit(c)} className={`${btn} justify-start text-left ${state}`}>{c}</button>;
          })}
        </div>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void submit(answer); }}>
          <textarea aria-label="Your answer" value={answer} disabled={!!grade} onChange={e => setAnswer(e.target.value)} rows={3}
            className="resize-none rounded-2xl border border-line bg-bg/60 p-3 text-fg placeholder:text-subtle" placeholder="Answer in a sentence…" />
          {!grade && <button type="submit" disabled={!answer.trim() || grading} className={`${btn} bg-fg text-bg disabled:opacity-40`}>Check</button>}
        </form>
      )}
      {grading && <p role="status"><ShinyText text="Checking…" color="rgba(255,255,255,.5)" shineColor="#fff" /></p>}
      {grade && <div aria-live="polite" className="flex flex-col gap-3">
        <p className="text-lg font-semibold">{grade.correct ? "Nailed it." : "Not quite."}</p>
        <p className="text-muted">{grade.feedback}</p>
        {cp.kind === "short" && !grade.correct && <p className="text-sm text-subtle">Model answer: {cp.answer}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className={`${btn} flex-1 bg-fg text-bg`}>Continue</button>
          {!grade.correct && <button type="button" onClick={() => onAskAbout(`I got this checkpoint wrong: "${cp.prompt}" I answered "${answer}". Why is the answer "${cp.answer}"?`)} className={`${btn} flex-1`}>Ask about it</button>}
        </div>
      </div>}
      {!grade && <button type="button" onClick={onDone} className="min-h-10 self-start rounded-full px-3 text-sm text-subtle transition-colors hover:text-fg">Skip</button>}
    </section>
  );
}
