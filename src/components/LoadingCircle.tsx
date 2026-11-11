// React Bits' LatticeLoader is a dot grid; use a CSS ring for circular PDF loading feedback.
export default function LoadingCircle({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="absolute inset-0 grid place-items-center">
    <span aria-hidden="true" className="size-7 animate-spin rounded-full border-2 border-fg/20 border-t-fg/80 motion-reduce:animate-none" />
  </div>;
}
