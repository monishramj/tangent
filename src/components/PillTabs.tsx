import type { ReactNode } from "react";

// Adapted from React Bits PillNav (David Haz): equal-width tabs, CSS glide instead of spring physics.
// https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/Components/PillNav/PillNav.tsx
// License: ./PillTabs.LICENSE
export default function PillTabs<T extends string>({ value, onValueChange, items }: {
  value: T; onValueChange: (value: T) => void;
  items: { value: T; label: string; content: ReactNode }[];
}) {
  const activeIndex = items.findIndex(item => item.value === value);
  return <div role="tablist" aria-label="Side panel tabs" className="w-fit shrink-0 rounded-full border border-line bg-black/30 p-1">
    <div className="relative flex">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-fg/15 shadow-[inset_0_1px_0_#ffffff18] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ width: "2.5rem", transform: `translateX(${Math.max(0, activeIndex) * 100}%)`, opacity: activeIndex < 0 ? 0 : 1 }} />
      {items.map((item, index) => <button key={item.value} role="tab" type="button" aria-label={item.label} title={item.label}
        aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1}
        onClick={() => onValueChange(item.value)}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
          onValueChange(items[next].value);
          (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
        }}
        className={`relative grid size-10 shrink-0 place-items-center rounded-full px-1.5 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg/60 ${value === item.value ? "text-fg" : "text-muted hover:text-fg"}`}>
        {item.content}
      </button>)}
    </div>
  </div>;
}
