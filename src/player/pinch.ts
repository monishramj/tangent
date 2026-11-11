type Point = { x: number; y: number };

/** Wrapper-local origin and the scroll that preserves the same content after resizing. */
export function pinchGeometry(point: Point, scroll: Point, inset: Point, scale: number, maxScroll?: Point) {
  const origin = { x: scroll.x + point.x - inset.x, y: scroll.y + point.y - inset.y };
  const target = { x: origin.x * scale - point.x + inset.x, y: origin.y * scale - point.y + inset.y };
  const clamped = maxScroll ? { x: Math.max(0, Math.min(maxScroll.x, target.x)), y: Math.max(0, Math.min(maxScroll.y, target.y)) } : target;
  return { origin, scroll: clamped, translate: { x: target.x - clamped.x, y: target.y - clamped.y } };
}
