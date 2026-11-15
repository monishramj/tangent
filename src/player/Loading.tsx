import { useEffect, useState } from "react";
import type { Progress } from "@/pipeline/streamVideo";

// Same open stroke as the library preparation ring (LibraryView PreparationOverlay).
const RING = "M16 4C9 3 4 9 4 16s5 12 12 12 12-5 12-12S23 4 16 4";

/** One plain line from the progress the pipeline already emits. */
export function stageLabel(progress?: Progress, compact = false): string {
  if (compact) {
    const total = progress?.scenesTotal ?? 0, ready = progress?.scenesReady ?? 0;
    return total > ready ? `Waiting for scene ${Math.min(total, ready + 1)} of ${total}` : "Buffering";
  }
  if (progress?.step === "formulas") return progress.formulas ? `Reading formulas · ${progress.formulas}` : "Reading formulas";
  if (progress?.step === "script") return "Writing the script";
  if (progress?.step === "narration") return "Narrating";
  if (progress?.step === "animation") return "Animating the first scene";
  return "Preparing your explanation";
}

const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Loading({ progress, compact = false }: { progress?: Progress; compact?: boolean }) {
  const [reduced, setReduced] = useState(reducedNow);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const label = stageLabel(progress, compact);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-4 z-[4] flex justify-center">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/80 px-5 py-4">
        <svg data-testid="player-ring" data-reduced={reduced ? "true" : "false"} className="player-ring" viewBox="0 0 32 32" aria-hidden="true">
          <path d={RING} />
        </svg>
        <p className="text-sm text-fg">{label}</p>
      </div>
    </div>
  );
}
