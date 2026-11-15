import { useEffect, useRef, useState } from "react";
import type { Progress } from "@/pipeline/streamVideo";

// Real stage progress (from the pipeline) + time inside the current stage against a learned estimate.
// Nothing reports progress inside a stage (Docling, claude -p), so past the estimate the bar holds and the
// label says how long it has been instead of creeping toward 100%. Estimates learn from past runs.
const STEPS = [
  { key: "formulas", label: "Reading formulas", sec: 3.3 }, // per formula
  { key: "script", label: "Writing the script", sec: 120 },
  { key: "narration", label: "Recording narration", sec: 15 },
  { key: "animation", label: "Animating the first scene", sec: 45 },
] as const;
type Key = typeof STEPS[number]["key"];
const LEARN_KEY = "tangent.stepSec";
const learned = (): Partial<Record<Key, number>> => { try { return JSON.parse(localStorage.getItem(LEARN_KEY) ?? "{}") ?? {}; } catch { return {}; } };
function learn(key: Key, sec: number) {
  if (!(sec > 0.5)) return;
  try { const l = learned(); l[key] = l[key] ? (l[key]! + sec) / 2 : sec; localStorage.setItem(LEARN_KEY, JSON.stringify(l)); } catch { /* fine */ }
}
const index = (p?: Progress) => !p ? 1 : p.scenesReady > 0 || p.step === "ready" ? STEPS.length : STEPS.findIndex(s => s.key === p.step);

/** expected = seconds per visible step; step indexes into it (expected.length = done). Holds at 95% of a step past its estimate. */
export function loadingFraction(step: number, inStepSec: number, expected: number[]) {
  if (step >= expected.length) return 1;
  const total = expected.reduce((a, b) => a + b, 0);
  const done = expected.slice(0, step).reduce((a, b) => a + b, 0);
  return (done + expected[step] * Math.min(.95, inStepSec / expected[step])) / total;
}

const clock = (sec: number) => sec >= 60 ? `${Math.floor(sec / 60)} min ${Math.floor(sec % 60)} s` : `${Math.ceil(sec)} s`;

export default function Loading({ progress, compact = false }: { progress?: Progress; compact?: boolean }) {
  const formulas = useRef(0);
  formulas.current = Math.max(formulas.current, progress?.formulas ?? 0); // the pipeline's later events don't carry it
  const steps = STEPS.filter(s => s.key !== "formulas" || formulas.current > 0);
  const raw = index(progress);
  const step = raw >= STEPS.length ? steps.length : steps.findIndex(s => s.key === STEPS[raw].key);
  const since = useRef({ step, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  if (since.current.step !== step) {
    const prev = steps[since.current.step], sec = (Date.now() - since.current.at) / 1000;
    if (prev) learn(prev.key, prev.key === "formulas" ? sec / formulas.current : sec);
    since.current = { step, at: Date.now() };
  }
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);
  const l = learned();
  const expected = steps.map(s => (l[s.key] ?? s.sec) * (s.key === "formulas" ? formulas.current : 1));
  const inStep = (now - since.current.at) / 1000;
  const fraction = loadingFraction(step, inStep, expected);
  const left = expected.slice(step).reduce((a, b) => a + b, 0) - inStep;
  const status = step >= steps.length ? "" : left > 0 && inStep < expected[step] ? `~${clock(left)} left` : `taking longer than usual · ${clock(inStep)}`;
  const current = steps[Math.min(step, steps.length - 1)];

  if (compact) return (
    <div role="status" aria-label="Buffering" className="glass absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-1.5 text-xs text-muted">
      Buffering{progress?.scenesTotal ? ` · scene ${Math.min(progress.scenesTotal, progress.scenesReady + 1)} of ${progress.scenesTotal}` : "…"}
    </div>
  );
  return (
    <div role="status" aria-label="Generation progress" className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8">
      <div className="glass w-full max-w-md rounded-2xl p-6">
        <div className="mb-2 flex justify-between text-sm"><span className="text-fg">{current.label}…</span><span className="text-subtle tabular-nums">{Math.round(fraction * 100)}%</span></div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-1.5 overflow-hidden rounded-full bg-fg/10">
          <div className="h-full rounded-full bg-fg transition-[width] duration-500 ease-out" style={{ width: `${fraction * 100}%` }} />
        </div>
        {status && <p className="mt-2 text-xs text-subtle tabular-nums">{status}</p>}
        <ol className="mt-5 flex flex-col gap-2 text-sm">
          {steps.map((s, i) => <li key={s.key} className={`flex items-center gap-3 ${i < step ? "text-muted" : i === step ? "text-fg" : "text-subtle"}`}>
            <span aria-hidden className={`grid size-5 place-items-center rounded-full border text-[10px] ${i < step ? "border-fg bg-fg text-bg" : "border-line"}`}>{i < step ? "✓" : i === step ? <span className="size-1.5 animate-pulse rounded-full bg-fg" /> : ""}</span>
            {s.label}{s.key === "formulas" ? <span className="text-subtle"> · {formulas.current}</span> : null}{s.key === "script" && progress?.scenesTotal ? <span className="text-subtle"> · {progress.beats.length} beats, {progress.scenesTotal} scenes</span> : null}
          </li>)}
        </ol>
      </div>
      {progress?.beats.length ? <div className="w-full max-w-md border-t border-line pt-4">
        <p className="mb-2 text-xs text-subtle">Coming up</p>
        {progress.beats.slice(0, 3).map((b, i) => <p key={i} className="fade-up text-[15px] text-muted" style={{ animationDelay: `${i * 400}ms` }}>“{b}”</p>)}
      </div> : null}
    </div>
  );
}
