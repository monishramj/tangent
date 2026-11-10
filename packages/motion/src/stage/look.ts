// The house look: tonal depth on black. A grey ramp, light from the top-left, hard flat shadows, a soft backdrop and a
// film-grain + vignette overlay. Textures are pre-rendered once (canvas 2D) and reused: nothing here costs per frame.
import { Texture } from "pixi.js";
import type { Point } from "./motion";

/** Grey ramp (bg -> white). Text stays white; greys are for surfaces only. */
export const TONE = { bg: "#060606", low: "#161616", mid: "#242424", high: "#3a3a3a", dim: "#8a8a8a", ink: "#ffffff" };
/** Light direction (unit, pointing from the light toward the scene): top-left. */
export const LIGHT: Point = [.6, .8];
/** Flat drop-shadow offset (fractions of stage height) along the light direction. */
export const SHADOW = .011;
/** Surface fill strength over black for an unlit body (≈ TONE.low) and its lit rim / shadow rim strengths. */
export const BODY = { fill: .1, rimLit: 1, rimDark: .42, shadow: .6 };

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
    const ground = x.createLinearGradient(0, 262, 0, 360); // ground plane under a faint horizon
    ground.addColorStop(0, "rgba(255,255,255,.045)"); ground.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = ground; x.fillRect(0, 262, 640, 98);
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
