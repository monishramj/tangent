import { TextArea } from '@/components/ui/TextField';
import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
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

/** Optional context a checkpoint can carry (src/gen/checkpoints.ts). Read through this type so the card works either way. */
type CpTable = { headers: string[]; rows: string[][] };
type WithContext = Checkpoint & { table?: CpTable; figure?: string };
const tableOf = (cp: Checkpoint) => { const t = (cp as WithContext).table; return t && Array.isArray(t.headers) && Array.isArray(t.rows) ? t : undefined; };
const figureOf = (cp: Checkpoint) => { const f = (cp as WithContext).figure; return typeof f === "string" && f ? f : undefined; };
// Absolute filesystem paths go through the asset protocol; URLs (asset:, http:, data:) pass through.
const fileSrc = (p: string) => p.startsWith("/") && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? convertFileSrc(p) : p;

const LETTERS = "ABCDE";
export const actionBtn = "flex min-h-11 items-center justify-center rounded-full px-[max(1rem,2cqw)] text-[clamp(14px,1.5cqw,17px)] font-semibold transition-transform duration-150 active:scale-[.97]";

/** What ties the question to the video: its table, its figure, or the last frame of its scene. */
export function CheckContext({ checkpoint: cp, thumb }: { checkpoint: Checkpoint; thumb?: string }) {
  const table = tableOf(cp), figure = figureOf(cp);
  if (table) return (
    <div data-testid="check-context" className="max-h-full min-h-0 overflow-auto rounded-[max(10px,1.2cqw)] border border-line">
      <table className="w-full border-collapse text-left text-[clamp(12px,1.35cqw,16px)] tabular-nums">
        <thead><tr>{table.headers.map((h, i) => <th key={i} scope="col" className="border-b border-line bg-fg/[0.06] px-3 py-1.5 font-semibold text-fg">{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-line/60 last:border-0">
          {r.map((c, j) => <td key={j} className="px-3 py-1.5 text-muted">{c}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  );
  const src = figure ? fileSrc(figure) : thumb;
  if (!src) return null;
  return (
    <figure data-testid="check-context" className="flex min-h-0 items-center justify-center overflow-hidden rounded-[max(10px,1.2cqw)] border border-line bg-black">
      <img src={src} alt={figure ? "Figure for this question" : "The end of the scene this question is about"} className="max-h-full w-full object-contain" draggable={false} />
    </figure>
  );
}

export type Answering = { answer: string; grading: boolean; grade: Grade | null };
export const blank: Answering = { answer: "", grading: false, grade: null };

/** Grade a response once; reports the result. State lives with the caller so a remount shows the same thing. */
export async function runGrade(cp: Checkpoint, response: string, provider: LLMProvider, set: (a: Answering) => void, onResult: (r: CheckpointResult) => void) {
  set({ answer: response, grading: true, grade: null });
  const g = await gradeAnswer(cp, response, provider);
  set({ answer: response, grading: false, grade: g });
  onResult({ response, correct: g.correct, at: Date.now() });
}

/** Prompt, context, choices or a short answer box, and the feedback. Controlled. */
export function Question({ checkpoint: cp, state, onAnswer, onSubmit, thumb, animate = true }: {
  checkpoint: Checkpoint; state: Answering; onAnswer: (s: string) => void; onSubmit: (response: string) => void; thumb?: string; animate?: boolean;
}) {
  const { answer, grading, grade } = state;
  const hasContext = !!(tableOf(cp) || figureOf(cp) || thumb);
  const long = cp.choices?.some(c => c.length > 48) ?? false;
  const prompt = animate
    ? <BlurText key={cp.id} text={cp.prompt} trigger="load" delay={35} stepDuration={0.25} blur={8} distance={14}
      className={`${hasContext ? "text-[clamp(17px,2.3cqw,32px)]" : "text-[clamp(20px,3.2cqw,44px)]"} leading-[1.12] font-extrabold tracking-[-0.02em] text-fg`} />
    : <p className={`${hasContext ? "text-[clamp(17px,2.3cqw,30px)]" : "text-[clamp(19px,2.8cqw,36px)]"} leading-[1.12] font-extrabold tracking-[-0.02em] text-fg`}>{cp.prompt}</p>;
  const body = (
    <div className="flex min-w-0 flex-col gap-[1.6cqw]">
      {prompt}
      {cp.kind === "mcq" ? (
        <div role="radiogroup" aria-label="Choices" className={`grid gap-[1cqw] ${long ? "grid-cols-1" : "grid-cols-2"}`}>
          {cp.choices!.map((c, i) => {
            const right = !!grade && c === cp.answer, wrong = !!grade && c === answer && !right;
            return (
              <motion.button key={c} type="button" role="radio" aria-checked={answer === c} disabled={!!grade || grading} onClick={() => onSubmit(c)}
                initial={animate ? { opacity: 0, y: 8 } : false} animate={{ opacity: !grade || right || wrong ? 1 : .35, y: 0 }} transition={{ delay: animate ? .12 + i * .04 : 0, duration: .22 }}
                className={`flex min-h-[max(2.75rem,5cqw)] items-center gap-[1cqw] rounded-[max(12px,1.3cqw)] border px-[1.4cqw] py-[0.8cqw] text-left text-[clamp(14px,1.6cqw,20px)] font-semibold transition-colors ${
                  right ? "border-fg bg-fg text-bg" : wrong ? "border-line text-subtle" : "border-line text-fg enabled:hover:border-fg/60 enabled:hover:bg-fg/[0.06]"}`}>
                <span aria-hidden className={`grid size-[max(1.6rem,2.3cqw)] shrink-0 place-items-center rounded-full border text-[0.75em] ${right ? "border-bg/30" : "border-line"}`}>{LETTERS[i]}</span>
                <span className={wrong ? "line-through" : undefined}>{c}</span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <form className="flex flex-col gap-[1cqw]" onSubmit={e => { e.preventDefault(); onSubmit(answer); }}>
          <TextArea aria-label="Your answer" value={answer} disabled={!!grade || grading} onChange={e => onAnswer(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(answer); } }}
            className="rounded-[max(12px,1.3cqw)] bg-transparent p-[1.2cqw] text-[clamp(14px,1.6cqw,20px)]" placeholder="Answer in a sentence…" />
          {!grade && <button type="submit" disabled={!answer.trim() || grading} className={`${actionBtn} self-start bg-fg text-bg disabled:opacity-40`}>Check</button>}
        </form>
      )}
      {grading && <p role="status" className="text-[clamp(14px,1.5cqw,18px)]"><ShinyText text="Checking…" color="rgba(255,255,255,.5)" shineColor="#fff" /></p>}
      {grade && <motion.div aria-live="polite" initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }} className="flex flex-col gap-[0.6cqw]">
        <p className="text-[clamp(17px,2.3cqw,30px)] font-extrabold tracking-tight">{grade.correct ? "Nailed it." : "Not quite."}</p>
        <p className="max-w-[70ch] text-[clamp(13px,1.45cqw,18px)] leading-snug text-muted">{grade.feedback}</p>
        {cp.kind === "short" && !grade.correct && <p className="text-[clamp(12px,1.3cqw,16px)] text-subtle">Model answer: {cp.answer}</p>}
      </motion.div>}
    </div>
  );
  if (!hasContext) return body;
  // Context on the left, the question on the right; stacks when the frame is narrow.
  return (
    <div className="grid min-h-0 gap-[2cqw] @[560px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex max-h-[38cqw] min-h-0 flex-col @max-[559px]:max-h-[28cqw]"><CheckContext checkpoint={cp} thumb={thumb} /></div>
      {body}
    </div>
  );
}

export const sourceLabel = (cp: Checkpoint) => cp.source === "textbook" ? `From the textbook${cp.cite ? ` · ${cp.cite}` : ""}` : "Generated question";

/** The question inside the 16:9 frame while the video is paused. Leaves room for the player chrome above and below. */
export default function CheckpointCard({ checkpoint: cp, index, total, provider, thumb, onResult, onContinue, onAskAbout }: {
  checkpoint: Checkpoint; index: number; total: number; provider: LLMProvider; thumb?: string;
  onResult: (r: CheckpointResult) => void; onContinue: () => void; onAskAbout: (q: string) => void;
}) {
  const [state, setState] = useState<Answering>(blank);
  const actions = useRef<HTMLDivElement>(null);
  // In a small frame the feedback can land below the fold: bring Continue into view once graded.
  useEffect(() => { if (state.grade) actions.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [state.grade]);
  const submit = (response: string) => {
    if (!response.trim() || state.grading || state.grade) return;
    void runGrade(cp, response, provider, setState, onResult);
  };
  const skip = () => { onResult({ response: "", correct: false, at: Date.now(), skipped: true }); onContinue(); };
  return (
    <MotionConfig reducedMotion="user">
      <motion.section aria-label="Checkpoint" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .26, ease: [0.2, 0.8, 0.2, 1] }}
        className="@container absolute inset-0 z-10 flex cursor-default flex-col gap-[1.6cqw] overflow-y-auto bg-black px-[5cqw] pt-[max(3.75rem,7cqw)] pb-[max(5.75rem,9cqw)]">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[clamp(11px,1.1cqw,13px)] font-semibold tracking-[0.18em] text-subtle uppercase">
          <span className="text-fg">Checkpoint {index + 1}<span className="text-subtle"> / {total}</span></span>
          <span aria-hidden className="h-px w-6 bg-line" />
          <span className="tracking-normal normal-case">{sourceLabel(cp)}</span>
        </p>
        <Question checkpoint={cp} state={state} thumb={thumb} onAnswer={a => setState(s => ({ ...s, answer: a }))} onSubmit={submit} />
        <div ref={actions} className="mt-auto flex flex-wrap items-center gap-2 pt-[0.6cqw]">
          {state.grade ? <>
            <button type="button" autoFocus onClick={onContinue} className={`${actionBtn} bg-fg text-bg hover:scale-[1.03]`}>Continue</button>
            {!state.grade.correct && <button type="button" onClick={() => onAskAbout(`I got this checkpoint wrong: "${cp.prompt}" I answered "${state.answer}". Why is the answer "${cp.answer}"?`)}
              className={`${actionBtn} border border-line text-fg hover:bg-fg/10`}>Ask about it</button>}
          </> : <button type="button" onClick={skip} disabled={state.grading} className={`${actionBtn} ml-auto font-medium text-subtle hover:text-fg`}>Skip</button>}
        </div>
      </motion.section>
    </MotionConfig>
  );
}
