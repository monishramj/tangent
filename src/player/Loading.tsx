import { useEffect, useRef, useState } from "react";
import type { Progress } from "@/pipeline/streamVideo";

// Real stage progress (from the pipeline) + a time-based fill inside the current stage, capped below 100%
// so the bar never claims a stage is done before it is. Typical durations with Haiku; tune as needed.
const STEPS = [
  { key: "script", label: "Writing the script", sec: 60, weight: .45 },
  { key: "narration", label: "Recording narration", sec: 12, weight: .15 },
  { key: "animation", label: "Animating the first scene", sec: 45, weight: .4 },
] as const;
const order = (p?: Progress) => !p ? 0 : p.scenesReady > 0 || p.step === "ready" ? 3 : p.step === "script" ? 0 : p.step === "narration" ? 1 : 2;

export function loadingFraction(step: number, inStepSec: number) {
  const done = STEPS.slice(0, step).reduce((s, x) => s + x.weight, 0);
  if (step >= STEPS.length) return 1;
  return done + STEPS[step].weight * Math.min(.92, 1 - Math.exp(-inStepSec / STEPS[step].sec));
}

export default function Loading({ progress, compact = false }: { progress?: Progress; compact?: boolean }) {
  const step = order(progress);
  const since = useRef({ step, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  if (since.current.step !== step) since.current = { step, at: Date.now() };
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);
  const fraction = loadingFraction(step, (now - since.current.at) / 1000);

  if (compact) return (
    <div role="status" aria-label="Buffering" className="glass absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-muted">
      Buffering{progress?.scenesTotal ? ` · scene ${Math.min(progress.scenesTotal, progress.scenesReady + 1)} of ${progress.scenesTotal}` : "…"}
    </div>
  );
  return (
    <div role="status" aria-label="Generation progress" className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-between text-sm"><span className="text-fg">{STEPS[Math.min(step, 2)].label}…</span><span className="text-subtle tabular-nums">{Math.round(fraction * 100)}%</span></div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-1.5 overflow-hidden rounded-full bg-fg/10">
          <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${fraction * 100}%` }} />
        </div>
        <ol className="mt-5 flex flex-col gap-2 text-sm">
          {STEPS.map((s, i) => <li key={s.key} className={`flex items-center gap-3 ${i < step ? "text-muted" : i === step ? "text-fg" : "text-subtle"}`}>
            <span aria-hidden className={`grid size-5 place-items-center rounded-full border text-[10px] ${i < step ? "border-fg bg-fg text-bg" : "border-line"}`}>{i < step ? "✓" : i === step ? <span className="size-1.5 animate-pulse rounded-full bg-fg" /> : ""}</span>
            {s.label}{i === 0 && progress?.scenesTotal ? <span className="text-subtle"> · {progress.beats.length} beats, {progress.scenesTotal} scenes</span> : null}
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
