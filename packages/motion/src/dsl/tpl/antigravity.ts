// Picture-first templates. Geometry and quantities are computed here, never supplied by the scene model.
import { z } from "zod";
import { type C, at, frac, orderedAnchors, s, spread, visual, visualAt } from "../tplkit";
import { ACCENT, MOTION } from "../../stage/motion";

const num = z.number().finite();
const Party = z.object({ name: s, ...visual });
export const TEMPLATES = {
  fill: z.object({ label: s, amount: num.nonnegative(), capacity: num.positive(), unit: s.max(12).optional(), ...visual }).refine(d => Number.isFinite(d.amount / d.capacity * 100), "fill percentage must be finite"),
  pictograph: z.object({ n: z.number().int().min(1).max(100), k: z.number().int().nonnegative(), label: s, ...visual }).refine(d => d.k <= d.n, "k must not exceed n"),
  dominoes: z.object({ title: s.optional(), items: z.array(z.object({ text: s, ...visual, ...at })).min(3).max(6) }),
  chat: z.object({ left: Party, right: Party, messages: z.array(z.object({ from: z.enum(["left", "right"]), text: s, typing: z.boolean().optional(), ...at })).min(2).max(6) }),
} as const;
type T = typeof TEMPLATES;
export const VARIANTS: Record<keyof T, string[]> = { fill: ["glass", "battery", "bar"], pictograph: ["grid", "sweep"], dominoes: ["row", "grow"], chat: ["phone", "bubbles"] };
const AR = 9 / 16;
const short = (t: string, n = 60) => t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
const text = (c: C, base: string, t: string, x: number, y: number, size: number, when: string, opts: Record<string, unknown> = {}) =>
  c.add({ id: c.id(base), type: "text", text: short(t), x, y, size, maxW: .8, opacity: 1, ...opts }, when, { style: "type" });
const shape = (c: C, base: string, x: number, y: number, width: number, height: number, when: string, opts: Record<string, unknown> = {}) =>
  c.add({ id: c.id(base), type: "shape", shape: "rect", x, y, width, height, ...opts }, when, { style: "pop", duration: MOTION.punchSec, easing: "outCubic" });

export function fillLevel(amount: number, capacity: number) {
  return { level: Math.min(1, amount / capacity), overflow: Math.max(0, amount - capacity), percent: Math.round(amount / capacity * 100) };
}
export function pictographGrid(n: number) {
  const cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols);
  const cell = Math.min(.13, .76 / (cols * AR), .5 / rows);
  return { cols, rows, cell };
}

type Pt = [number, number];
/** Corners of a side-on slab (thickness w, height h) tipped right by `a` radians about its bottom-right corner (px, 0); y up. */
export const slab = (px: number, w: number, h: number, a: number): Pt[] =>
  ([[0, 0], [-w, 0], [-w, h], [0, h]] as Pt[]).map(([x, y]) => [px + x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)]);
/** Separating-axis test for two convex quads (touching counts as clear). */
export function overlaps(A: Pt[], B: Pt[]) {
  for (const Q of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = Q[i], [x2, y2] = Q[(i + 1) % 4], nx = y1 - y2, ny = x2 - x1;
    const pa = A.map(([x, y]) => x * nx + y * ny), pb = B.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
  }
  return true;
}
/** Steepest tip of slab (px, w, h) that stays clear of `next` (bisection: the overlap only grows with the angle). */
const leanOn = (px: number, w: number, h: number, next: Pt[]) => {
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (overlaps(slab(px, w, h, m), next)) hi = m; else lo = m; }
  return lo;
};
/** Angles of every domino after step k (k tips onto k+1, the last falls flat; earlier ones settle onto their neighbour). */
export function dominoStages(P: number[], W: number[], H: number[]): number[][] {
  const n = P.length, a = P.map(() => 0);
  return P.map((_, k) => {
    a[k] = k === n - 1 ? Math.PI / 2 : leanOn(P[k], W[k], H[k], slab(P[k + 1], W[k + 1], H[k + 1], 0));
    for (let j = k - 1; j >= 0; j--) a[j] = leanOn(P[j], W[j], H[j], slab(P[j + 1], W[j + 1], H[j + 1], a[j + 1]));
    return [...a];
  });
}
/** Domino row in stage-width units: P = bottom-right corners, W thickness, H height; a stick figure (x X, size S as a
 * fraction of stage height) stands left of the first one with its pointing hand at that domino's face. Spacing is even
 * (labels get equal columns) and widens when the height cap leaves room; in "grow" it stays short enough for the small
 * first domino to reach the second. The row (figure to the flat last domino) is centred in .07-.93. */
export function dominoLayout(n: number, grow: boolean) {
  const FLOOR = .7, rel = Array.from({ length: n }, (_, i) => grow ? .45 ** ((n - 1 - i) / (n - 1)) : 1);
  const lead = rel[0] * (1 / 6 + .53 * 1.15), tail = rel[n - 1], room = .86 - .004, gmax = grow ? .85 * (rel[0] + rel[1] / 6) : .75;
  let g = Math.min(.62, gmax), u = room / (lead + g * (n - 1) + tail);
  if (u > .44 * AR) { u = .44 * AR; g = Math.min(gmax, Math.max(.5, (room / u - lead - tail) / (n - 1))); }
  const H = rel.map(r => r * u), W = H.map(h => h / 6), S = Math.max(.16, 1.15 * H[0] / AR);
  const span = u * (lead + g * (n - 1) + tail) + .004, X = .5 - span / 2 + .21 * S * AR;
  const P = [X + .318 * S * AR + .004 + W[0]];
  for (let i = 1; i < n; i++) P.push(P[i - 1] + g * u);
  return { P, W, H, FLOOR, X, S };
}

/** Chat thread layout (stage fractions; x widths in stage-width units, y/heights in stage-height units from the thread
 * top). Text is wrapped here from an average glyph width so every bubble hugs its lines; if the thread is taller than
 * `room`, font, padding and gaps shrink together. Messages are capped at 4 lines. */
export function chatLayout(texts: string[], colW: number, room: number, f0: number) {
  const build = (f: number) => {
    const cw = .45 * f * AR, padX = .8 * f * AR, padY = .5 * f, lineH = 1.15 * f, gap = .7 * f, maxChars = Math.max(6, Math.floor((colW * .78 - 2 * padX) / cw));
    let y = 0;
    const items = texts.map(t => {
      const lines: string[] = [];
      for (const word of t.split(/\s+/).filter(Boolean)) {
        const cur = lines[lines.length - 1];
        if (cur !== undefined && (cur + " " + word).length <= maxChars) lines[lines.length - 1] = cur + " " + word;
        else for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      }
      if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].slice(0, maxChars - 1).trimEnd() + "…"; }
      const w = Math.max(...lines.map(l => l.length)) * cw + 2 * padX + .004, h = lines.length * lineH + 2 * padY, item = { text: lines.join("\n"), w, h, y };
      y += h + gap;
      return item;
    });
    return { items, f, padX, padY, lineH, total: y - gap, typingW: 1.9 * f * AR + 2 * padX, typingH: lineH + 2 * padY };
  };
  const a = build(f0);
  return a.total <= room ? a : build(f0 * room / a.total);
}

/** Wrap label words into three lines; only overlong labels lose whole words. */
export function dominoLabel(text: string, chars: number) {
  const lines: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    const i = lines.length - 1;
    if (i >= 0 && (lines[i] + " " + word).length <= chars) lines[i] += " " + word;
    else lines.push(word);
  }
  if (lines.length > 3) {
    lines.length = 3;
    while (lines[2].length + 1 > chars && lines[2].includes(" ")) lines[2] = lines[2].slice(0, lines[2].lastIndexOf(" "));
    lines[2] += "…";
  }
  return lines.join("\n");
}

export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {
  fill(c, d, v) {
    const { level, overflow, percent } = fillLevel(d.amount, d.capacity), bar = v === "bar", glass = v === "glass";
    // vertical: container left of centre, number on the right; bar: a wide track with the number under it
    const x = bar ? .5 : .36, y = bar ? .42 : .5, w = bar ? .72 : glass ? .15 : .19, h = bar ? .15 : glass ? .58 : .5, floor = y + h / 2;
    text(c, "fill_label", d.label, .5, .1, .055, frac(0), { weight: "bold" });
    if (glass) { // open-topped glass: two walls and a base, so it reads as a vessel rather than a box
      const l = x - w / 2, r = x + w / 2, t = y - h / 2;
      c.add({ id: c.id("fill_shell"), type: "line", from: [l, t], to: [l + .008, floor] }, frac(.02), { style: "draw" });
      c.add({ id: c.id("fill_shell"), type: "line", from: [r, t], to: [r - .008, floor] }, frac(.02), { style: "draw" });
      c.add({ id: c.id("fill_shell"), type: "line", from: [l + .008, floor], to: [r - .008, floor] }, frac(.02), { style: "draw" });
    } else shape(c, "fill_shell", x, y, w, h, frac(.02));
    if (v === "battery") shape(c, "fill_terminal", x, y - h / 2 - .02, w * .35, .03, frac(.03), { filled: true });
    c.add({ id: c.id("fill_floor"), type: "line", from: bar ? [x - w / 2 - .02, floor + .006] : [.12, floor + .004], to: bar ? [.95, floor + .006] : [.62, floor + .004] }, frac(0), { style: "draw" });
    // One liquid body grows out of its base (bottom, or the left end for the bar); the counter shares its curve, so the
    // number tracks the level. Overloaded: a steady (linear) pour reaches the brim at T, where the counter on the same line
    // reads exactly 100% and keeps climbing while the excess rolls over the lip, runs down the outside and spreads into a puddle.
    const pad = glass ? .0015 : bar ? .012 : .014, innerW = w - 2 * pad, innerH = h - 2 * pad / AR * (bar ? 1 : .5), F = frac(.16);
    const T = overflow > 0 ? Math.min(1.5, 300 / percent) : 1.8, curve = overflow > 0 ? "linear" : "inOutCubic";
    if (level > 0) {
      const lw = bar ? innerW * level : innerW, lh = bar ? h - 2 * pad / AR : innerH * level;
      c.key(c.add({ id: c.id("fill_liquid"), type: "shape", shape: "rect", filled: true, color: ACCENT, pivot: bar ? "left" : "bottom", radius: .006,
        x: bar ? x - innerW / 2 + lw / 2 : x, y: bar ? y : floor - pad / AR * .5 - lh / 2, width: lw, height: lh,
        ...(glass ? { radius: 0, points: [
          [-(w / 2 - .008 * (1 - level) - pad) / lw, -.5], [(w / 2 - .008 * (1 - level) - pad) / lw, -.5],
          [(w / 2 - .008 - pad) / lw, .5], [-(w / 2 - .008 - pad) / lw, .5],
        ] } : {}) }, F, { style: "grow", duration: T, easing: curve }));
    }
    const cx = bar ? .5 : .74, cy = bar ? .66 : .45;
    const counter = c.add({ id: c.id("fill_percent"), type: "counter", from: 0, to: percent, suffix: "%", size: .12, x: cx, y: cy, color: ACCENT }, F,
      { style: "type", duration: T * Math.max(100, percent) / 100, easing: curve });
    if (!(level > 0)) c.key(counter);
    text(c, "fill_amount", `${d.amount} / ${d.capacity}${d.unit ? " " + d.unit : ""}`, cx, bar ? .78 : .58, .036, frac(.18), { opacity: .7, maxW: .4 });
    // capacity mark at the brim (top of the vessel, or the end of the bar)
    const brimY = y - h / 2 + pad / AR * .5, brimX = x + innerW / 2;
    c.add({ id: c.id("fill_capacity"), type: "line", from: bar ? [brimX, y - h * .8] : [x - w / 2 - .03, brimY], to: bar ? [brimX, y + h * .5] : [x + w / 2, brimY], dashed: true }, frac(.08), { style: "draw" });
    text(c, "fill_caplabel", "CAPACITY", bar ? brimX : x - w / 2 - .09, bar ? y - h * .8 - .035 : brimY, .024, frac(.08), { maxW: .14, opacity: .55 });
    visualAt(c, "fill_icon", d, cx, bar ? .22 : .27, .09, frac(.04));
    if (overflow > 0) { // T: the moment the liquid reaches the brim
      const wall = x + w / 2, sx = wall + .008, lipY = bar ? y - h / 2 : brimY;
      const line = floor + (bar ? .006 : .004), pool = line - .003, puddleW = bar ? .1 : .16;
      c.act({ at: F, do: "highlight", target: counter, delay: T }); // the number punches as it passes 100%
      // Sample a cubic over the rim, then follow the outside wall into the puddle.
      const start: Pt = [wall - pad - .008, lipY], bend: Pt = [sx, lipY + .035];
      const foot: Pt = [sx - (glass ? .008 : 0), pool];
      const points: Pt[] = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16, u = 1 - t;
        return [u ** 3 * start[0] + 3 * u * u * t * (sx + .004) + 3 * u * t * t * sx + t ** 3 * bend[0],
          u ** 3 * start[1] + 3 * u * u * t * (lipY - .02) + 3 * u * t * t * (lipY - .02) + t ** 3 * bend[1]];
      });
      // Ease the falling stream into the floor instead of ending in a right-angle join.
      for (let i = 1; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        points.push([u ** 3 * bend[0] + 3 * u * u * t * sx + 3 * u * t * t * (foot[0] - .012) + t ** 3 * foot[0],
          u ** 3 * bend[1] + 3 * u * u * t * (pool - .05) + 3 * u * t * t * pool + t ** 3 * pool]);
      }
      c.add({ id: c.id("fill_stream"), type: "line", color: ACCENT, from: start, to: foot, points, thick: 2.6 }, F,
        { style: "draw", delay: T, duration: .65, easing: "inOutCubic" });
      c.add({ id: c.id("fill_puddle"), type: "shape", shape: "circle", filled: true, color: ACCENT, pivot: "left",
        x: foot[0] - .012 + puddleW / 2, y: pool, width: puddleW, height: .018 }, F,
        { style: "grow", delay: T + .6, duration: 1.2, easing: "outCubic" });
      c.add({ id: c.id("fill_overflow"), type: "text", text: `+${Number(overflow.toPrecision(5))}${d.unit ? " " + d.unit : ""} overflow`, color: ACCENT, opacity: 1,
        x: Math.min(.95 - .11, sx + puddleW / 2), y: line + .05, size: .03, maxW: .22 }, F, { style: "type", delay: T + .7 });
    }
  },
  pictograph(c, d, v) {
    const { cols, rows, cell } = pictographGrid(d.n), times = spread(d.k, .2, .76), pct = d.k / d.n * 100;
    text(c, "pic_label", d.label, .5, .1, .052, frac(0), { weight: "bold" });
    for (let i = 0; i < d.n; i++) { // a waffle grid: every row aligned to the same columns
      const row = Math.floor(i / cols), col = i % cols;
      const x = .5 + (col - (cols - 1) / 2) * cell * AR, y = .47 + (row - (rows - 1) / 2) * cell;
      const when = frac(v === "sweep" ? .2 + .56 * col / Math.max(1, cols - 1) : times[i] ?? .2);
      const emoji = !!d.emoji;
      // colour emoji can't be tinted: a translucent accent disc marks them instead
      if (i < d.k && emoji) shape(c, "pic_lit", x, y, cell * .86 * AR, cell * .86, when, { shape: "circle", ghost: true, color: ACCENT });
      const id = visualAt(c, "pic_icon", emoji || d.icon ? d : { icon: "user" }, x, y, cell * .6, frac(.02 + .08 * row / Math.max(1, rows)))!;
      if (i < d.k) c.act({ at: when, do: "transform", target: id, scale: 1.18, ...(emoji ? {} : { color: ACCENT }), duration: MOTION.punchSec, easing: "outBack" });
      else c.act({ at: frac(.12), do: "fade", target: id, to: .28, duration: .3 });
      if (i === 0) c.key(id);
    }
    c.add({ id: c.id("pic_percent"), type: "counter", from: 0, to: pct, decimals: Number.isInteger(pct) ? 0 : 1, suffix: "%", x: .5, y: .83, size: .095, color: ACCENT }, frac(.2), { duration: 1.4 });
    text(c, "pic_ratio", `${d.k} in ${d.n}`, .5, .93, .032, frac(.25), { opacity: .65 });
  },
  dominoes(c, d, v) {
    // Side view of real dominoes, each tipping about its bottom-right corner. The angles are solved (dominoStages), so a
    // domino comes to rest leaning on the next one and never cuts through it; the last one falls flat with a camera punch.
    // A stick figure flicks the first one and celebrates at the end. "grow": each domino bigger than the last.
    if (d.title) text(c, "dom_title", d.title, .5, .1, .05, frac(0), { weight: "bold" });
    const n = d.items.length, L = dominoLayout(n, v === "grow"), { P, W, H, FLOOR } = L, stages = dominoStages(P, W, H);
    const A = orderedAnchors(c.say, spread(n + 1, .2, .86), [...d.items.map(it => it.at), undefined]);
    c.add({ id: c.id("dom_floor"), type: "line", from: [.05, FLOOR], to: [.95, FLOOR] }, frac(0), { style: "draw" });
    const man = c.add({ id: c.id("dom_person"), type: "person", pose: "stand", facing: "right", x: L.X, y: FLOOR - L.S / 2, size: L.S }, frac(0), { style: "draw", duration: .6 });
    c.act({ at: A[0], do: "pose", target: man, to: "point", duration: .25 }); // the flick
    const maxW = Math.min(.24, Math.min(...P.slice(1).map((p, i) => p - P[i])) * .92);
    const ids = d.items.map((it, i) => {
      const last = i === n - 1, hh = H[i] / AR, x = P[i] - W[i] / 2;
      const id = c.add({ id: c.id("dom_body"), type: "shape", shape: "rect", x, y: FLOOR - hh / 2, width: W[i], height: hh, filled: true, pivot: "corner", color: last ? ACCENT : "#ffffff" },
        frac(.03 * i), { style: "grow", duration: .45, easing: "outCubic" }); // rises out of the floor
      if (last) c.key(id);
      const lx = Math.min(.95 - maxW / 2, Math.max(.05 + maxW / 2, x));
      const size = n >= 5 ? .025 : .03, labelText = dominoLabel(it.text, Math.floor(maxW / (.52 * size * AR)));
      const label = text(c, "dom_label", labelText, lx, FLOOR + .08, size, frac(.03 * i), { text: labelText, maxW, maxH: .105, opacity: 1, color: "#5c5c5c" }); // dim until its domino falls
      const icon = visualAt(c, "dom_icon", it, x, FLOOR - hh - .075, .06, frac(.03 * i));
      const t = A[i], delay = i ? 0 : .18; // the first one waits for the hand
      c.act({ at: t, do: "transform", target: label, color: last ? ACCENT : "#ffffff", delay, duration: .3 });
      if (icon) c.act({ at: t, do: "transform", target: icon, scale: 1.2, ...(it.emoji ? {} : { color: ACCENT }), delay, duration: MOTION.punchSec, easing: "outBack" });
      return id;
    });
    // stage k: domino k tips (onto k+1, or flat); every domino before it settles further onto its neighbour. Followers get a
    // slightly longer motion with the same curve, so they always lag the one they lean on and never overlap it.
    stages.forEach((ang, k) => {
      const prev = k ? stages[k - 1] : P.map(() => 0), lead = k === n - 1 ? .5 : .4, delay = k ? 0 : .18;
      ang.forEach((a, j) => {
        if (Math.abs(a - prev[j]) < 1e-3) return;
        c.act({ at: A[k], do: "transform", target: ids[j], rotate: a, delay, duration: lead + (j < k ? .12 : 0), easing: "inCubic" });
      });
    });
    c.act({ at: A[n - 1], do: "camera", shake: .018, delay: .5, duration: .4 }); // the last one lands
    c.act({ at: A[n], do: "pose", target: man, to: "celebrate", delay: .2, duration: .4 });
  },
  chat(c, d, v) {
    // A messaging UI between two stick figures. phone: the thread inside a phone that fills the frame height; bubbles: the
    // thread floats between the figures. Bubbles are rounded rects sized to their (estimated, pre-wrapped) text, left
    // party outlined on the left, right party in accent on the right. A typing bubble (bouncing dots) holds the spot before
    // a reply and gives way to it. Long threads shrink together so the whole conversation stays on screen.
    const phone = v === "phone", L = phone ? .372 : .27, R = phone ? .628 : .73, top = phone ? .15 : .12, bottom = phone ? .92 : .93;
    if (phone) {
      c.add({ id: c.id("chat_phone"), type: "shape", shape: "rect", x: .5, y: .5, width: .3, height: .92, radius: .045 }, frac(0), { style: "draw", duration: .5 });
      c.add({ id: c.id("chat_speaker"), type: "shape", shape: "pill", filled: true, color: "#555555", x: .5, y: .085, width: .045, height: .012 }, frac(.02), { style: "pop" });
      c.add({ id: c.id("chat_rule"), type: "line", from: [.36, .125], to: [.64, .125] }, frac(.03), { style: "draw" });
    }
    const figs = (["left", "right"] as const).map(side => {
      const p = side === "left" ? d.left : d.right, x = side === "left" ? (phone ? .17 : .13) : (phone ? .83 : .87), S = .42, y = .6;
      const id = c.add({ id: c.id(`chat_${side}`), type: "person", pose: "stand", facing: side === "left" ? "right" : "left", x, y, size: S, label: short(p.name, 18) }, frac(0), { style: "draw", duration: .6 });
      visualAt(c, "chat_avatar", p, x, y - S * .51 - .055, .06, frac(.04));
      return id;
    });
    const msgs = chatLayout(d.messages.map(m => m.text), R - L, bottom - top, phone ? .036 : .044);
    const ev = d.messages.flatMap((m, i) => m.typing ? [{ i, typing: true, at: undefined }, { i, typing: false, at: m.at }] : [{ i, typing: false, at: m.at }]);
    const A = orderedAnchors(c.say, spread(ev.length, .1, .86), ev.map(e => e.at));
    const typingAt = new Map<number, string>(), posed = new Map<string, string>(), poses = ["explain", "point"] as const;
    ev.forEach((e, k) => {
      const m = d.messages[e.i], left = m.from === "left", b = msgs.items[e.i], fig = figs[left ? 0 : 1], when = A[k];
      const look = left ? {} : { filled: true, color: ACCENT }, slide = { style: "slide", edge: "bottom", duration: .35, easing: "outExpo" };
      if (e.typing) {
        const tw = msgs.typingW, y = top + b.y + msgs.typingH / 2;
        typingAt.set(e.i, c.add({ id: c.id("chat_typing"), type: "shape", shape: "rect", typing: true, radius: msgs.typingH / 2, ...(left ? { color: "#777777" } : look),
          x: left ? L + tw / 2 : R - tw / 2, y, width: tw, height: msgs.typingH }, when, slide));
        c.act({ at: when, do: "pose", target: fig, to: "think", duration: .4 }); posed.set(fig, "think");
        return;
      }
      const t = typingAt.get(e.i);
      if (t) c.act({ at: when, do: "fade", target: t, duration: .1 });
      const x0 = left ? L : R - b.w, y = top + b.y + b.h / 2;
      c.key(c.add({ id: c.id("chat_message"), type: "shape", shape: "rect", radius: msgs.lineH / 2 + msgs.padY, ...(left ? { color: "#9a9a9a" } : look),
        x: x0 + b.w / 2, y, width: b.w, height: b.h }, when, slide));
      c.add({ id: c.id("chat_text"), type: "text", text: b.text, align: "left", x: x0 + msgs.padX, y, size: msgs.f, maxW: b.w - 2 * msgs.padX + .006, maxH: b.h, opacity: 1,
        ...(left ? {} : { color: "#000000" }) }, when, slide);
      const pose = poses[Number(posed.get(fig) === "explain")];
      c.act({ at: when, do: "pose", target: fig, to: pose, duration: .35 }); posed.set(fig, pose);
    });

  },
};
export const SAMPLES: Record<keyof T, unknown> = {
  fill: { label: "Buffer under pressure", amount: 12, capacity: 10, unit: "MB", icon: "database" },
  pictograph: { n: 10, k: 3, label: "Three in ten people", icon: "user" },
  dominoes: { title: "One change cascades", items: [{ text: "Compare", icon: "search", at: "parent" }, { text: "Swap", icon: "refresh", at: "swaps" }, { text: "Check again", emoji: "⚡", at: "again" }] },
  chat: { left: { name: "Client", icon: "laptop" }, right: { name: "Server", icon: "database" }, messages: [{ from: "left", text: "Request", at: "parent" }, { from: "right", text: "Checking…", at: "children", typing: true }, { from: "left", text: "Ready?", at: "swaps" }, { from: "right", text: "Response", at: "again", typing: true }] },
};
export const GUIDE = `- fill {label,amount,capacity,unit?,icon?|emoji?} glass|battery|bar. Load/capacity; computed fill spills when overloaded.
- pictograph {n:1-100,k,icon?|emoji?,label} grid|sweep. k of n light up; percentage computed.
- dominoes {title?,items:[{text,icon?|emoji?,at?}] 3-6} row|grow. Cause/effect chain: each step tips the next (grow: small cause, big effect).
- chat {left:{name,icon?|emoji?},right:{...},messages:[{from:"left"|"right",text,at?,typing?}] 2-6} phone|bubbles. Requests, protocols, handshakes.`;
