import { useEffect, useState } from "react";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import Stepper, { Step } from "@/components/Stepper";
import Counter from "@/components/Counter";
import Icon from "@/components/Icon";
import type { LLMProvider } from "@/llm/provider";
import type { Checkpoint } from "@/gen/checkpoints";
import { actionBtn, blank, Question, runGrade, sourceLabel, type Answering, type CheckpointResult } from "./CheckpointCard";

// Neutral greys instead of the Stepper's default violet-tinted dark theme (black × Code Report).
const STEPPER_VARS = { "--stepper-track": "rgba(255,255,255,0.14)", "--stepper-faint": "rgba(255,255,255,0.28)", "--stepper-solid": "#ffffff", "--stepper-solid-ink": "#000000" } as React.CSSProperties;

/** Every available question in one focused flow, then the score and which scenes to rewatch. */
export default function Quiz({ checkpoints, provider, thumbs, onResult, onClose, onJump }: {
  checkpoints: Checkpoint[]; provider: LLMProvider; thumbs: Record<number, string>;
  onResult: (id: string, r: CheckpointResult) => void; onClose: () => void; onJump: (sceneIndex: number) => void;
}) {
  const [step, setStep] = useState(1);
  const [states, setStates] = useState<Record<string, Answering>>({});
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const total = checkpoints.length, done = step > total;
  const cp = checkpoints[step - 1] as Checkpoint | undefined;
  const st = (cp && states[cp.id]) || blank;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const set = (id: string) => (a: Answering) => setStates(p => ({ ...p, [id]: a }));
  const submit = (c: Checkpoint, response: string) => {
    const s = states[c.id] ?? blank;
    if (!response.trim() || s.grading || s.grade) return;
    void runGrade(c, response, provider, set(c.id), r => onResult(c.id, r));
  };
  const skip = () => {
    if (!cp) return;
    setSkipped(p => new Set(p).add(cp.id));
    onResult(cp.id, { response: "", correct: false, at: Date.now(), skipped: true });
    setStep(step + 1);
  };
  const right = checkpoints.filter(c => states[c.id]?.grade?.correct).length;
  const missed = checkpoints.filter(c => states[c.id]?.grade ? !states[c.id].grade!.correct : skipped.has(c.id));
  const rewatch = [...new Set(missed.map(c => c.afterScene))].sort((a, b) => a - b);

  const results = (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <p className="text-xs font-semibold tracking-[0.16em] text-subtle uppercase">Your score</p>
        <p className="mt-1 mb-2 flex h-16 items-end gap-2 leading-none tabular-nums" aria-label={`${right} of ${total} right`}>
          <Counter value={right} fontSize={56} fontWeight={800} textColor="var(--fg)" motionBlur={false} />
          <span className="text-2xl font-semibold text-subtle">/ {total}</span>
        </p>
        <p className="text-muted">{right === total ? "Clean sweep. You've got this section." : rewatch.length ? "Worth another look:" : ""}</p>
      </div>
      {rewatch.length > 0 && <ul aria-label="Scenes to rewatch" className="flex flex-col gap-2">
        {rewatch.map(s => {
          const qs = missed.filter(c => c.afterScene === s);
          return <li key={s}>
            <button type="button" onClick={() => onJump(s)} aria-label={`Rewatch scene ${s + 1}`}
              className="flex w-full items-center gap-3 rounded-2xl border border-line p-2 pr-4 text-left transition-colors hover:bg-fg/[0.06]">
              {thumbs[s] ? <img src={thumbs[s]} alt="" className="aspect-video w-28 shrink-0 rounded-lg border border-line object-cover" />
                : <span aria-hidden className="grid aspect-video w-28 shrink-0 place-items-center rounded-lg border border-line text-xs text-subtle">Scene {s + 1}</span>}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-fg">Scene {s + 1}</span>
                <span className="line-clamp-1 text-sm text-subtle">{qs.map(c => c.prompt).join(" · ")}</span>
              </span>
              <span className="flex items-center gap-1 text-sm text-muted"><Icon icon={PlayIcon} size={14} className="fill-current" />Rewatch</span>
            </button>
          </li>;
        })}
      </ul>}
      <button type="button" onClick={onClose} className={`${actionBtn} self-start bg-fg text-bg`}>Back to the video</button>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Quiz" className="fade-in absolute inset-0 z-40 grid place-items-center bg-black/85 p-3 sm:p-6">
      <div className="@container flex max-h-full w-[min(880px,100%)] flex-col overflow-hidden rounded-3xl border border-line bg-black shadow-2xl">
        <header className="flex items-center gap-3 px-5 pt-4 pb-2">
          <p className="text-xs font-semibold tracking-[0.16em] text-subtle uppercase">
            {done ? "Results" : <>Question <span className="text-fg tabular-nums">{step}</span> of {total}{cp ? <span className="tracking-normal normal-case"> · {sourceLabel(cp)} · after scene {cp.afterScene + 1}</span> : null}</>}
          </p>
          <button type="button" aria-label="Close quiz" title="Close (Esc)" onClick={onClose} className="ml-auto grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg"><Icon icon={Cancel01Icon} size={18} /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-2">
          <Stepper step={step} indicator="bars" linear disableStepIndicators showFooter={false} frame={false} width="100%" transition="slide" style={STEPPER_VARS}
            completedContent={results}>
            {checkpoints.map(c => <Step key={c.id}>
              <Question checkpoint={c} animate={false} state={states[c.id] ?? blank} thumb={thumbs[c.afterScene]}
                onAnswer={a => setStates(p => ({ ...p, [c.id]: { ...(p[c.id] ?? blank), answer: a } }))} onSubmit={r => submit(c, r)} />
            </Step>)}
          </Stepper>
        </div>
        {!done && <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          {st.grade
            ? <button type="button" autoFocus onClick={() => setStep(step + 1)} className={`${actionBtn} ml-auto bg-fg text-bg`}>{step === total ? "See results" : "Next question"}</button>
            : <button type="button" onClick={skip} disabled={st.grading} className={`${actionBtn} ml-auto font-medium text-subtle hover:text-fg`}>Skip</button>}
        </footer>}
      </div>
    </div>
  );
}
