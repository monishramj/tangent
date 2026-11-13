import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export default function Menu({ label, menuLabel = label, trigger, children, open: controlled, onOpenChange, above = false, triggerClassName = '', form = false }: {
  label: string; menuLabel?: string; trigger: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; above?: boolean; triggerClassName?: string; form?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlled ?? localOpen;
  const change = onOpenChange ?? setLocalOpen;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled), select:not(:disabled)') ?? []);
  useEffect(() => {
    if (!open) return;
    if (!form) {
      const options = items();
      (options.find(item => item.getAttribute('aria-checked') === 'true') ?? options[0])?.focus();
    }
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) change(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, change, form]);
  return <div ref={root} className="ui-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) change(false); }} onKeyDown={e => {
    if (e.key === 'Escape' && open) { e.preventDefault(); change(false); button.current?.focus(); }
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); change(true);
      requestAnimationFrame(() => {
        const options = items();
        const current = options.indexOf(document.activeElement as HTMLElement);
        let index = current;
        if (e.key === 'Home' || (!open && e.key === 'ArrowDown')) index = 0;
        else if (e.key === 'End' || (!open && e.key === 'ArrowUp')) index = options.length - 1;
        else index = (current + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[index]?.focus();
      });
    }
  }}>
    <button ref={button} type="button" aria-label={label} aria-haspopup={form ? "dialog" : "menu"} aria-expanded={open} aria-controls={id} className={`ui-menu-trigger ${triggerClassName}`} onClick={() => change(!open)}>{trigger}</button>
    {open && <div id={id} role={form ? "dialog" : "menu"} aria-label={menuLabel} className={`ui-menu-content ${above ? 'ui-menu-above' : ''}`} onClick={e => {
      if ((e.target as HTMLElement).closest('[role="menuitem"], [role="menuitemradio"]')) { change(false); button.current?.focus(); }
    }}>{children}</div>}
  </div>;
}
