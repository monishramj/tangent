import { Cancel01Icon, MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import Counter from "@/components/Counter";
import Icon from "@/components/Icon";
import type { Checkpoint } from "@/gen/checkpoints";

export type CheckStatus = "upcoming" | "right" | "wrong" | "skipped";
const STATUS_TEXT: Record<CheckStatus, string> = { upcoming: "Upcoming", right: "Right", wrong: "Wrong", skipped: "Skipped" };

export function StatusMark({ s, n }: { s: CheckStatus; n: number }) {
  return (
    <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
      s === "right" ? "bg-fg text-bg" : s === "wrong" ? "border border-fg/60 text-fg" : s === "skipped" ? "border border-dashed border-line text-subtle" : "border border-line text-subtle"}`}>
      {s === "right" ? <Icon icon={Tick02Icon} size={14} /> : s === "wrong" ? <Icon icon={Cancel01Icon} size={13} /> : s === "skipped" ? <Icon icon={MinusSignIcon} size={13} /> : n}
    </span>
  );
}

/** The Checks tab: score, Take the quiz, and every checkpoint grouped by the scene it follows. */
export default function Checks({ checkpoints, status, active, onOpen, isReady, onQuiz, complete }: {
  checkpoints: Checkpoint[]; status: Record<string, CheckStatus>; active?: string | null;
  onOpen: (cp: Checkpoint) => void; isReady: (cp: Checkpoint) => boolean; onQuiz: () => void; complete: boolean;
}) {
  if (!checkpoints.length) return <p className="p-6 text-center text-sm text-subtle">Checks show up here once the video's questions are ready.</p>;
  const right = checkpoints.filter(c => status[c.id] === "right").length;
  const answered = checkpoints.filter(c => status[c.id] === "right" || status[c.id] === "wrong").length;
  const ready = checkpoints.filter(isReady).length;
  const groups = new Map<number, { cp: Checkpoint; n: number }[]>();
  checkpoints.forEach((cp, i) => groups.set(cp.afterScene, [...(groups.get(cp.afterScene) ?? []), { cp, n: i + 1 }]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-end justify-between gap-3 px-4 pt-1 pb-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-subtle uppercase">Score</p>
          <p className="flex items-baseline gap-1 text-fg tabular-nums" aria-label={`${right} of ${checkpoints.length} right`}>
            <Counter value={right} fontSize={32} fontWeight={800} textColor="var(--fg)" intro={false} motionBlur={false} fade={0.2} />
            <span className="text-lg font-semibold text-subtle">/ {checkpoints.length}</span>
          </p>
          <p className="text-xs text-subtle">{answered} answered</p>
        </div>
        <button type="button" disabled={!ready} onClick={onQuiz}
          className="flex min-h-11 flex-col items-center justify-center rounded-full bg-fg px-5 text-sm font-semibold text-bg transition-transform active:scale-[.97] disabled:opacity-40">
          Take the quiz
          <span className="text-[11px] font-medium opacity-60">{complete || ready === checkpoints.length ? `${ready} questions` : `${ready} of ${checkpoints.length} ready`}</span>
        </button>
      </div>
      <div aria-label="Checks" role="navigation" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {[...groups.entries()].map(([scene, items]) => (
          <section key={scene} aria-label={`After scene ${scene + 1}`} className="border-t border-line pt-2 pb-1">
            <h3 className="px-1 pb-1 text-xs font-semibold tracking-[0.12em] text-subtle uppercase">After scene {scene + 1}</h3>
            <ol className="flex flex-col">
              {items.map(({ cp, n }) => {
                const s = status[cp.id] ?? "upcoming", ok = isReady(cp);
                return (
                  <li key={cp.id}>
                    <button type="button" disabled={!ok} aria-current={active === cp.id || undefined} onClick={() => onOpen(cp)}
                      aria-label={`Checkpoint ${n}: ${cp.prompt} (${s})`}
                      className={`flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-40 ${
                        active === cp.id ? "bg-fg/10 text-fg" : "text-muted enabled:hover:bg-fg/[0.06] enabled:hover:text-fg"}`}>
                      <StatusMark s={s} n={n} />
                      <span className="min-w-0 flex-1"><span className="line-clamp-2">{cp.prompt}</span>
                        <span className="text-xs text-subtle">{ok ? STATUS_TEXT[s] : "Not generated yet"}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
