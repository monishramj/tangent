import { useEffect, useState } from "react";
import type { Progress } from "@/pipeline/streamVideo";

// Same open stroke as the library preparation ring (LibraryView PreparationOverlay).
const RING = "M16 4C9 3 4 9 4 16s5 12 12 12 12-5 12-12S23 4 16 4";

/** Script is 20%; each ready scene earns its share of the remaining 80%.
 * An animation event proves that scene's narration (60% of its work) finished.
 * Scene totals can grow and concurrent jobs can report out of order: retain the high-water mark.
 */
export function generationPercent(progress?: Progress, previous = 0, done = false): number {
  let percent = 0;
  if (done) percent = 100;
  else if (progress && progress.step !== "formulas" && progress.step !== "script") {
    const total = progress.scenesTotal;
    const ready = Math.max(0, progress.scenesReady);
    const narrated = progress.step === "animation" && ready < total ? 0.6 : 0;
    percent = total > 0 ? Math.min(99, Math.floor(20 + 80 * (ready + narrated) / total)) : 20;
  }
  return Math.max(0, Math.min(100, Math.max(previous, percent)));
}

export function useGenerationPercent(progress?: Progress, done = false): number | undefined {
  const [previous, setPrevious] = useState(0);
  const percent = generationPercent(progress, previous, done);
  useEffect(() => { setPrevious(percent); }, [percent]);
  return progress ? percent : undefined;
}

export function stageLabel(progress?: Progress): string {
  if (progress?.step === "formulas") return progress.formulas ? `Reading formulas · ${progress.formulas}` : "Reading formulas";
  if (progress?.step === "script") return "Writing script";
  if (progress?.step === "narration") {
    return progress.scenesTotal > 0
      ? `Narrating scene ${Math.min(progress.scenesTotal, Math.max(1, progress.scene + 1))} of ${progress.scenesTotal}`
      : "Narrating";
  }
  return "Building scenes";
}

const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Loading({ progress, percent, compact = false }: { progress?: Progress; percent?: number; compact?: boolean }) {
  const [reduced, setReduced] = useState(reducedNow);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const label = stageLabel(progress);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-[4] grid place-items-center">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/80 px-5 py-4">
        <svg data-testid="player-ring" data-reduced={reduced ? "true" : "false"} className="player-ring" viewBox="0 0 32 32" aria-hidden="true">
          <path d={RING} />
        </svg>
        <p className="text-sm text-fg/90 tabular-nums">{compact ? "Updating video" : "Generating video"}{percent !== undefined ? ` · ${percent}%` : ""}</p>
        {progress && <p className="text-xs text-fg/50 tabular-nums">{label}</p>}
      </div>
    </div>
  );
}
