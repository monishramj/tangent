import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "motion/react";
import BlurText from "@/components/BlurText";
import ShinyText from "@/components/ShinyText";
import type { LLMProvider } from "@/llm/provider";
import { gradeAnswer, type Checkpoint, type Grade } from "@/gen/checkpoints";
import type { JsonStore } from "@/storage/store";

export type CheckpointResult = { response: string; correct: boolean; at: number; skipped?: boolean };
export const results = (s: JsonStore) => ({
  get: async (videoId: string) => (await s.read<Record<string, CheckpointResult>>(`checks-${videoId}`)) ?? {},
  async put(videoId: string, id: string, r: CheckpointResult) { await s.write(`checks-${videoId}`, { ...(await this.get(videoId)), [id]: r }); },
});

const LETTERS = "ABCDE";
const action = "flex min-h-11 items-center justify-center rounded-full px-[max(1rem,2cqw)] text-[clamp(14px,1.5cqw,18px)] font-semibold transition-transform duration-150 active:scale-[.97]";

/** The question, inside the 16:9 frame while the video is paused. Black, a bold kinetic title, big choices, feedback in place. */
export default function CheckpointCard({ checkpoint: cp, index, total, provider, onResult, onContinue, onAskAbout }: {
  checkpoint: Checkpoint; index: number; total: number; provider: LLMProvider;
  onResult: (r: CheckpointResult) => void; onContinue: () => void; onAskAbout: (q: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const actions = useRef<HTMLDivElement>(null);
  // In a small frame the feedback can land below the fold: bring Continue into view once graded.
  useEffect(() => { if (grade) actions.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [grade]);
  const submit = async (response: string) => {
    if (!response.trim() || grading || grade) return;
    setAnswer(response); setGrading(true);
    const g = await gradeAnswer(cp, response, provider);
    setGrade(g); setGrading(false);
    onResult({ response, correct: g.correct, at: Date.now() });
  };
  const skip = () => { onResult({ response: "", correct: false, at: Date.now(), skipped: true }); onContinue(); };
  const source = cp.source === "textbook" ? `From the textbook${cp.cite ? ` · ${cp.cite}` : ""}` : "Generated question";
  return (
    <MotionConfig reducedMotion="user">
      <motion.section aria-label="Checkpoint" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .28, ease: [0.2, 0.8, 0.2, 1] }}
        className="absolute inset-0 z-10 flex cursor-default flex-col gap-[2.2cqw] overflow-y-auto bg-black px-[6cqw] py-[4.5cqw] [container-type:inline-size]">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[clamp(11px,1.15cqw,14px)] font-semibold tracking-[0.18em] text-subtle uppercase">
          <span className="text-fg">Checkpoint {index + 1}<span className="text-subtle"> / {total}</span></span>
          <span aria-hidden className="h-px w-6 bg-line" />
          <span className="tracking-normal normal-case">{source}</span>
        </p>
        <BlurText key={cp.id} text={cp.prompt} trigger="load" delay={45} stepDuration={0.3} blur={8} distance={18}
          className="text-[clamp(20px,3.4cqw,46px)] leading-[1.08] font-extrabold tracking-[-0.02em] text-fg" />

        {cp.kind === "mcq" ? (
          <div role="radiogroup" aria-label="Choices" className={`grid gap-[1.2cqw] ${cp.choices!.some(c => c.length > 42) ? "grid-cols-1" : "grid-cols-2"}`}>
            {cp.choices!.map((c, i) => {
              const right = !!grade && c === cp.answer, wrong = !!grade && c === answer && !right;
              return (
                <motion.button key={c} type="button" role="radio" aria-checked={answer === c} disabled={!!grade || grading} onClick={() => void submit(c)}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: !grade || right || wrong ? 1 : .35, y: 0 }} transition={{ delay: .15 + i * .05, duration: .25 }}
                  className={`group flex min-h-[max(2.75rem,6cqw)] items-center gap-[1.2cqw] rounded-[max(12px,1.4cqw)] border px-[1.6cqw] py-[1cqw] text-left text-[clamp(15px,1.75cqw,22px)] font-semibold transition-colors ${
                    right ? "border-fg bg-fg text-bg" : wrong ? "border-line text-subtle" : "border-line text-fg enabled:hover:border-fg/60 enabled:hover:bg-fg/[0.06]"}`}>
                  <span aria-hidden className={`grid size-[max(1.75rem,2.6cqw)] shrink-0 place-items-center rounded-full border text-[0.75em] ${right ? "border-bg/30" : "border-line"}`}>{LETTERS[i]}</span>
                  <span className={wrong ? "line-through" : undefined}>{c}</span>
                </motion.button>
              );
            })}
          </div>
        ) : (
          <form className="flex flex-col gap-[1.2cqw]" onSubmit={e => { e.preventDefault(); void submit(answer); }}>
            <textarea aria-label="Your answer" value={answer} disabled={!!grade} onChange={e => setAnswer(e.target.value)} rows={2}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(answer); } }}
              className="resize-none rounded-[max(12px,1.4cqw)] border border-line bg-transparent p-[1.4cqw] text-[clamp(15px,1.75cqw,22px)] text-fg placeholder:text-subtle focus-visible:border-fg/60" placeholder="Answer in a sentence…" />
            {!grade && <button type="submit" disabled={!answer.trim() || grading} className={`${action} self-start bg-fg text-bg disabled:opacity-40`}>Check</button>}
          </form>
        )}

        {grading && <p role="status" className="text-[clamp(14px,1.5cqw,18px)]"><ShinyText text="Checking…" color="rgba(255,255,255,.5)" shineColor="#fff" /></p>}
        {grade && <motion.div aria-live="polite" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }} className="flex flex-col gap-[1cqw]">
          <p className="text-[clamp(18px,2.6cqw,34px)] font-extrabold tracking-tight">{grade.correct ? "Nailed it." : "Not quite."}</p>
          <p className="max-w-[70ch] text-[clamp(14px,1.6cqw,20px)] text-muted">{grade.feedback}</p>
          {cp.kind === "short" && !grade.correct && <p className="text-[clamp(13px,1.4cqw,17px)] text-subtle">Model answer: {cp.answer}</p>}
        </motion.div>}

        <div ref={actions} className="mt-auto flex flex-wrap items-center gap-2 pt-[1cqw]">
          {grade ? <>
            <button type="button" autoFocus onClick={onContinue} className={`${action} bg-fg text-bg hover:scale-[1.03]`}>Continue</button>
            {!grade.correct && <button type="button" onClick={() => onAskAbout(`I got this checkpoint wrong: "${cp.prompt}" I answered "${answer}". Why is the answer "${cp.answer}"?`)}
              className={`${action} border border-line text-fg hover:bg-fg/10`}>Ask about it</button>}
          </> : <button type="button" onClick={skip} disabled={grading} className={`${action} ml-auto font-medium text-subtle hover:text-fg`}>Skip</button>}
        </div>
      </motion.section>
    </MotionConfig>
  );
}
