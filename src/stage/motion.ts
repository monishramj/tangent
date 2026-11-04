import type { SceneObject } from "../dsl/schema";
export type Ease = "outCubic" | "outBack" | "inOutQuad";
export type Style = "draw" | "pop" | "type" | "slide" | "stagger";
export const clamp01 = (p: number) => Math.max(0, Math.min(1, p));
export const progress = (t: number, start: number, end: number) => end <= start ? Number(t >= start) : clamp01((t - start) / (end - start));
export function ease(p: number, name: Ease = "outCubic") {
  p = clamp01(p);
  if (p === 0 || p === 1) return p;
  if (name === "outBack") return 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
  if (name === "inOutQuad") return p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  return 1 - (1 - p) ** 3;
}
export const defaultStyle = (o: SceneObject): Style => {
  if (o.style) return o.style;
  if (["shape", "arrow", "line"].includes(o.type)) return "draw";
  if (["text", "code"].includes(o.type)) return "type";
  if (["Array", "Tree", "flow", "table", "bits", "stack"].includes(o.type)) return "stagger";
  return "pop";
};
export function staggerProgress(p: number, i: number, count: number, gap = .12) {
  const step = Math.min(gap, .8 / Math.max(1, count - 1));
  return clamp01((p - i * step) / (1 - step * (count - 1)));
}
export type Point = [number, number];
export function pathPoint(points: Point[], p: number, arc = 0): Point {
  p = clamp01(p);
  if (p === 0) return points[0];
  if (p === 1) return points[points.length - 1];
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let d = length * p;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1], dx = points[i][0] - x, dy = points[i][1] - y, len = Math.hypot(dx, dy);
    if (d <= len || i === points.length - 1) {
      const k = len ? d / len : 0, bend = Math.sin(Math.PI * p) * arc;
      return [x + dx * k + (len ? dy / len * bend : 0), y + dy * k - (len ? dx / len * bend : 0)];
    }
    d -= len;
  }
  return points[0];
}
/** Trace a polyline by distance; call only when repainting graphics. */
export function tracePoints(points: Point[], p: number): Point[] {
  const end = pathPoint(points, p);
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]);
  const out = [points[0]];
  let d = total * clamp01(p);
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]);
    if (d < len) break;
    out.push(points[i]); d -= len;
  }
  out.push(end); return out;
}
export type Focus = [number, number, number, number];
const DEFAULT_FOCUS: Focus[] = [[0, 0, 1, 1], [.05, .05, .95, .95]];
export function focusAt(boxes: Focus[] = DEFAULT_FOCUS, p: number): Focus {
  const step = clamp01(p) * Math.max(0, boxes.length - 1);
  const i = Math.floor(step), a = boxes[i], b = boxes[Math.min(i+1, boxes.length-1)], k = ease(step-i, "inOutQuad");
  return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k, a[3]+(b[3]-a[3])*k];
}
