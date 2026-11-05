import { Cancel01Icon, MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import Counter from "@/components/Counter";
import Icon from "@/components/Icon";
import type { Checkpoint } from "@/gen/checkpoints";

export type CheckStatus = "upcoming" | "right" | "wrong" | "skipped";

/** The persistent strip under the controls: every checkpoint in order, its status, and a running score. */
export default function Checks({ checkpoints, status, active, onOpen, isReady }: {
  checkpoints: Checkpoint[]; status: Record<string, CheckStatus>; active?: string | null;
  onOpen: (cp: Checkpoint) => void; isReady: (cp: Checkpoint) => boolean;
}) {
  if (!checkpoints.length) return null;
  const right = checkpoints.filter(c => status[c.id] === "right").length;
  return (
    <nav aria-label="Checks" className="flex items-center gap-3 border-t border-line pt-2">
      <p className="flex shrink-0 items-baseline gap-1.5 text-xs font-semibold tracking-[0.16em] text-subtle uppercase">
        Checks
        <span className="text-sm font-semibold tracking-normal text-fg tabular-nums" aria-label={`${right} of ${checkpoints.length} right`}>
          <Counter value={right} fontSize={14} fontWeight={600} textColor="var(--fg)" intro={false} motionBlur={false} fade={0.2} />
          <span className="text-subtle">/{checkpoints.length}</span>
        </span>
      </p>
      <ol className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {checkpoints.map((cp, i) => {
          const s = status[cp.id] ?? "upcoming", ready = isReady(cp);
          return (
            <li key={cp.id} className="shrink-0">
              <button type="button" disabled={!ready} aria-current={active === cp.id || undefined} onClick={() => onOpen(cp)}
                aria-label={`Checkpoint ${i + 1}: ${cp.prompt} (${s})`} title={cp.prompt}
                className={`flex h-9 max-w-[16rem] items-center gap-2 rounded-full border pr-3 pl-1.5 text-sm transition-colors disabled:cursor-default disabled:opacity-40 ${
                  active === cp.id ? "border-fg bg-fg/10 text-fg" : "border-line text-muted enabled:hover:border-fg/50 enabled:hover:text-fg"}`}>
                <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
                  s === "right" ? "bg-fg text-bg" : s === "wrong" ? "border border-fg/60 text-fg" : s === "skipped" ? "border border-dashed border-line text-subtle" : "border border-line text-subtle"}`}>
                  {s === "right" ? <Icon icon={Tick02Icon} size={14} /> : s === "wrong" ? <Icon icon={Cancel01Icon} size={13} /> : s === "skipped" ? <Icon icon={MinusSignIcon} size={13} /> : i + 1}
                </span>
                <span className="truncate">{cp.prompt}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
