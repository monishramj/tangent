import { useEffect, useId, useRef, type ReactNode } from "react";

// Non-modal side panel: the video stays visible. Focus moves in on open, back to the opener on close.
export default function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!ref.current!.contains(document.activeElement)) ref.current!.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <aside
      ref={ref}
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="slide-in fixed inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-line bg-surface outline-none"
    >
      <header className="flex items-center justify-between py-2 pr-2 pl-6">
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close panel" className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">{children}</div>
    </aside>
  );
}
