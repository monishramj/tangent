// The house look: tonal depth on black. A grey ramp, light from the top-left, hard flat shadows, a soft backdrop and a
// film-grain + vignette overlay. Textures are pre-rendered once (canvas 2D) and reused: nothing here costs per frame.
import { type ColorSource, type Graphics, Texture } from "pixi.js";
import { roundPoly, startAtTop, symmetricTrace } from "./geometry";
import { STROKE, window01, type Point } from "./motion";

/** Grey ramp (bg -> white). Text stays white; greys are for surfaces only. */
export const TONE = { bg: "#060606", low: "#161616", mid: "#242424", high: "#3a3a3a", dim: "#8a8a8a", ink: "#ffffff" };
/** Light direction (unit, pointing from the light toward the scene): top-left. */
export const LIGHT: Point = [.6, .8];
/** Flat drop-shadow offset (fractions of stage height) along the light direction. */
export const SHADOW = .011;
/** Surface fill strength over black for an unlit body (≈ TONE.low) and its lit rim / shadow rim strengths. */
export const BODY = { fill: .15, rimLit: 1, rimDark: .42, shadow: .6 };

/** Runs of consecutive segments on the lit (top-left) side of a shape centred on 0,0 with half-size (a, b). */
export function litRuns(pts: Point[], a: number, b: number): Point[][] {
  const runs: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i][0] + pts[i - 1][0]) / 2, my = (pts[i][1] + pts[i - 1][1]) / 2;
    if (mx / (a || 1) * LIGHT[0] + my / (b || 1) * LIGHT[1] < -.02) { if (!cur.length) cur.push(pts[i - 1]); cur.push(pts[i]); }
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Closed outline (starting top-centre, so it traces symmetrically) of a w×h rounded rect centred on 0,0. */
export const rectLoop = (w: number, h: number, r: number) => startAtTop(roundPoly([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], r));
/** Closed outline of a circle of radius r centred on 0,0, starting at the top. */
export const circleLoop = (r: number): Point[] => Array.from({ length: 33 }, (_, i) => { const a = -Math.PI / 2 + i / 32 * 2 * Math.PI; return [Math.cos(a) * r, Math.sin(a) * r]; });

/** A body (cards, nodes, bubbles, cells, bars): flat hard shadow, a low surface, the outline dim with its lit (top-left)
 * side in ink. `loop` is a closed outline around 0,0, drawn at (x, y). p is the draw-on: the outline is traced (the lit side
 * brightening as the pen passes) and the fill and shadow arrive in the last 30%, so a body is "drawn, then becomes solid".
 * hl blends toward the inverted key body (white fill, shadow kept, no rim). */
export function body(g: Graphics, loop: Point[], x: number, y: number, h: number, fg: ColorSource, bg: ColorSource,
  { p = 1, hl = 0, sw = h * STROKE.line, face = BODY.fill, shadow = true, alpha = 1 }: { p?: number; hl?: number; sw?: number; face?: number; shadow?: boolean; alpha?: number } = {}) {
  if (p <= 0 || alpha <= 0) return;
  const at = (pts: Point[], dx = 0, dy = 0) => pts.flatMap(([px, py]) => [px + x + dx, py + y + dy]);
  const fillA = window01(p, .7, 1) * alpha, d = h * SHADOW;
  if (fillA > 0) {
    const flat = at(loop);
    if (shadow) g.poly(at(loop, d * .75, d)).fill({ color: 0x000000, alpha: BODY.shadow * fillA });
    g.poly(flat).fill({ color: bg, alpha: fillA })
      .poly(flat).fill({ color: fg, alpha: (face + (1 - face) * .92 * hl) * fillA });
  }
  const part = symmetricTrace(loop, p), line = { width: sw, color: fg, cap: "round", join: "round" } as const;
  if (part.length < 2) return;
  g.poly(at(part), false).stroke({ ...line, alpha: (BODY.rimDark + (1 - BODY.rimDark) * hl) * alpha });
  if (hl < 1) {
    let a = 0, b = 0; for (const [px, py] of loop) { a = Math.max(a, Math.abs(px)); b = Math.max(b, Math.abs(py)); }
    for (const run of litRuns(part, a, b)) g.poly(at(run), false).stroke({ ...line, alpha: (1 - hl) * alpha });
  }
}

/** Leader tick (CrashCourse "pointed at"): a short, slightly bowed hair line from a label toward the thing it names,
 * drawn on with the label (p). Length is clamped to 3-5% of stage height along the from -> to direction. */
export function leaderTick(g: Graphics, from: Point, to: Point, h: number, fg: ColorSource, p = 1) {
  if (p <= 0) return;
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy) || 1, L = Math.min(h * .05, Math.max(h * .03, len)) * Math.min(1, p);
  const ux = dx / len, uy = dy / len, bow = L * .12;
  g.moveTo(from[0], from[1]).quadraticCurveTo(from[0] + ux * L / 2 - uy * bow, from[1] + uy * L / 2 + ux * bow, from[0] + ux * L, from[1] + uy * L)
    .stroke({ width: Math.max(1, h * STROKE.hair), color: fg, alpha: .7, cap: "round" });
}

const rand = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function canvas(w: number, h: number, paint: (x: CanvasRenderingContext2D) => void): Texture | null {
  try {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    if (!x) return null;
    paint(x);
    return Texture.from(c);
  } catch { return null; } // no canvas (tests): the look degrades to flat black
}
let back: Texture | null | undefined, over: Texture | null | undefined;
/** Soft backdrop: a pool of light up-left, two large low-contrast forms and a ground plane, so frames have depth. */
export function backdropTexture() {
  return back ??= canvas(640, 360, x => {
    x.fillStyle = TONE.bg; x.fillRect(0, 0, 640, 360);
    const pool = x.createRadialGradient(250, 130, 10, 250, 130, 430);
    pool.addColorStop(0, "#1d1d1d"); pool.addColorStop(.55, "#0e0e0e"); pool.addColorStop(1, "#050505");
    x.fillStyle = pool; x.fillRect(0, 0, 640, 360);
    for (const [cx, cy, r, a] of [[520, 70, 190, .035], [90, 300, 230, .03]]) { // big blurred forms
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 640, 360);
    }
    const ground = x.createLinearGradient(0, 215, 0, 360); // ground plane: light pooling low in the frame, no hard horizon
    ground.addColorStop(0, "rgba(255,255,255,0)"); ground.addColorStop(.55, "rgba(255,255,255,.04)"); ground.addColorStop(1, "rgba(255,255,255,.015)");
    x.fillStyle = ground; x.fillRect(0, 215, 640, 145);
  });
}
/** Film grain + vignette, drawn once (seeded noise: the same frame always looks the same). */
export function overlayTexture() {
  return over ??= canvas(960, 540, x => {
    const img = x.createImageData(960, 540), r = rand(7);
    for (let i = 0; i < img.data.length; i += 4) { const v = r(); img.data[i] = img.data[i + 1] = img.data[i + 2] = v < .5 ? 0 : 255; img.data[i + 3] = Math.abs(v - .5) * 26; }
    x.putImageData(img, 0, 0);
    const v = x.createRadialGradient(480, 270, 250, 480, 270, 620);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.5)");
    x.fillStyle = v; x.fillRect(0, 0, 960, 540);
  });
}
