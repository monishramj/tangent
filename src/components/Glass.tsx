import type { HTMLAttributes } from "react";

// Tinted glass surface in the style of React Bits' GlassSurface: blurred backdrop, faint white tint,
// a hairline edge and an inner top highlight. Monochrome on purpose (black × Code Report).
export default function Glass({ className = "", strong = false, ...rest }: HTMLAttributes<HTMLDivElement> & { strong?: boolean }) {
  return <div {...rest} className={`glass ${strong ? "glass-strong" : ""} ${className}`} />;
}
