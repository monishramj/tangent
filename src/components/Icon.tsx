import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

// Decorative only: the owning button carries the accessible name.
export default function Icon({ icon, size = 24, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={className} aria-hidden="true" focusable="false" />;
}
