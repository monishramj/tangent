// Physical comparisons: the model supplies labels/data; geometry and outcomes are computed here.
import { z } from "zod";
import { type C, at, frac, orderedAnchors, s, visual, visualAt } from "../tplkit";
import { ACCENT, ease, MOTION, type Point } from "../../stage/motion";
import { formatCount } from "../../stage/geometry";

const num = z.number().finite();
const Side = z.object({ label: s, weight: num.nonnegative(), ...visual, ...at });
const Growth = z.enum(["1", "log n", "n", "n log n", "n^2", "2^n"]);
const Runner = z.object({ label: s, growth: Growth.optional(), time: num.positive().optional(), ...visual, ...at })
  .refine(d => (d.growth !== undefined) !== (d.time !== undefined), "supply either growth or time");
export const TEMPLATES = {
  scale: z.object({ title: s.optional(), left: Side, right: Side }),
  race: z.object({ title: s.optional(), n: num.int().min(2).max(1e6).default(16), unit: s.max(8).default("ms"), runners: z.array(Runner).min(2).max(4) })
    .refine(d => d.runners.every(r => (r.growth !== undefined) === (d.runners[0].growth !== undefined)), "use all growth kinds or all numeric times"),
  gauge: z.object({ label: s, value: num, min: num.default(0), max: num.default(100), unit: s.max(8).optional(),
    zones: z.array(z.object({ to: num, label: s })).min(2).max(4).optional() })
    .refine(d => d.min < d.max && Number.isFinite(d.max - d.min) && Number.isFinite(d.value - d.min), "min must be below max with a finite span")
    .refine(d => !d.zones || (d.zones.every((z, i) => z.to > (i ? d.zones![i - 1].to : d.min) && z.to <= d.max) && d.zones[d.zones.length - 1].to === d.max), "zones must increase from min and end at max"),
} as const;
type T = typeof TEMPLATES;
export const VARIANTS: Record<keyof T, string[]> = { scale: ["tip", "balance"], race: ["lanes", "podium"], gauge: ["dial", "meter"] };
const AR = 9 / 16;
const short = (t: string, n = 28) => t.length > n ? `${t.slice(0, n - 1)}…` : t;
const text = (c: C, id: string, t: string, x: number, y: number, size: number, when: string, extra: Record<string, unknown> = {}) =>
  c.add({ id: c.id(id), type: "text", text: short(t), x, y, size, maxW: .8, opacity: 1, ...extra }, when, { style: "type" });
const shape = (c: C, id: string, kind: string, x: number, y: number, width: number, height: number, when: string, extra: Record<string, unknown> = {}) =>
  c.add({ id: c.id(id), type: "shape", shape: kind, x, y, width, height, ...extra }, when, { style: "draw", duration: MOTION.punchSec });
const line = (c: C, id: string, from: Point | string, to: Point | string, when: string, extra: Record<string, unknown> = {}) =>
  c.add({ id: c.id(id), type: "line", from, to, ...extra }, when, { style: "draw", duration: MOTION.punchSec });
const head = (c: C, title?: string) => title && text(c, "title", title, .5, .1, .052, frac(0), { weight: "bold" });

/** Normalising first avoids overflow for large, finite weights. Positive means the right pan drops. */
export function scaleAngle(left: number, right: number) {
  const max = Math.max(left, right);
  return max ? .24 * (right / max - left / max) / (right / max + left / max) : 0;
}
export function weightStack(weight: number, max: number) { return weight === 0 ? 0 : Math.max(1, Math.ceil(6 * (weight / max))); }
/** Log costs preserve relative speed even when 2^n itself would overflow. */
export function logCost(growth: z.infer<typeof Growth>, n: number) {
  const l = Math.log2(n);
  return growth === "1" ? 0 : growth === "log n" ? Math.log2(l) : growth === "n" ? l : growth === "n log n" ? l + Math.log2(l) : growth === "n^2" ? 2 * l : n;
}
export function raceProgress(costs: number[]) {
  const min = Math.min(...costs);
  return costs.map(cost => Math.min(1, 2 ** (min - cost) * 2));
}
export function gaugeAngle(value: number, min: number, max: number) { return Math.PI + Math.PI * Math.max(0, Math.min(1, (value - min) / (max - min))); }
const polar = (angle: number, radius: number, cx: number, cy: number): Point => [cx + Math.cos(angle) * radius * AR, cy + Math.sin(angle) * radius];

export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {
  scale(c, d, v) {
    head(c, d.title);
    const theta = scaleAngle(d.left.weight, d.right.weight), max = Math.max(d.left.weight, d.right.weight);
    const when = orderedAnchors(c.say, [.08, .22, .44], [d.left.at, d.right.at, undefined]);
    const pivotY = .42, arm = .45;
    shape(c, "fulcrum", "triangle", .5, .61, .105, .38, frac(0), { filled: true });
    const ends: string[] = [];
    [d.left, d.right].forEach((side, i) => {
      const sign = i ? 1 : -1, x = .5 + sign * arm * AR, y = pivotY;
      // The beam joins these tiny anchors; each pan travels with its anchor and remains upright.
      const parts: { id: string; dx: number; dy: number }[] = [];
      const add = (id: string, dx: number, dy: number) => { parts.push({ id, dx, dy }); return id; };
      ends.push(add(shape(c, `hinge${i}`, "circle", x, y, .004 * AR, .004, frac(0), { filled: true }), 0, 0));
      add(shape(c, `hanger${i}`, "rect", x, y + .115, .002, .23, frac(0)), 0, .115);
      add(shape(c, `pan${i}`, "pill", x, y + .23, .18, .025, frac(0)), 0, .23);
      add(text(c, `label${i}`, side.label, x, y + .3, .038, when[i], { maxW: .27, weight: "bold" }), 0, .3);
      add(text(c, `weight${i}`, String(side.weight), x, y + .355, .03, when[i], { maxW: .22, opacity: .6 }), 0, .355);
      const count = weightStack(side.weight, max);
      for (let j = 0; j < count; j++) {
        const dx = ((j % 3) - (Math.min(3, count) - 1) / 2) * .045, dy = .18 - Math.floor(j / 3) * .066;
        const id = visualAt(c, `weight${i}_${j}`, side.icon || side.emoji ? side : { icon: "weight" }, x + dx, y + dy, .06, when[i]);
        if (id) add(id, dx, dy);
      }
      for (const part of parts) {
        // A sampled outBack path includes the overshoot (move clamps easing progress to its path).
        const path: Point[] = Array.from({ length: 33 }, (_, j) => {
          const p = j / 32, a = theta * ease(p, "outBack") + (v === "balance" ? Math.sin(p * Math.PI * 4) * .055 * (1 - p) : 0);
          return [.5 + sign * Math.cos(a) * arm * AR + part.dx, pivotY + sign * Math.sin(a) * arm + part.dy];
        });
        if (theta === 0 && v !== "balance") path.splice(1, 0, [x + part.dx, y + part.dy + sign * .025]);
        c.act({ at: when[2], do: "move", target: part.id, path, duration: 1.5, easing: "inOutSine" });
      }
    });
    c.key(line(c, "beam", ends[0], ends[1], frac(0), { color: ACCENT }));
  },
  race(c, d, v) {
    head(c, d.title ?? (d.runners[0].growth ? `Cost at n = ${d.n}` : "Race the clock"));
    const costs = d.runners.map(r => r.growth ? logCost(r.growth, d.n) : Math.log2(r.time!));
    const min = Math.min(...costs), progress = raceProgress(costs), n = d.runners.length;
    const start = .3, finish = .83, startAt = frac(.3), finishAt = frac(.76);
    const podium = v === "podium", bottom = podium ? .65 : .79;
    line(c, "finish", [finish + .035, .22], [finish + .035, bottom + .08], frac(0), { dashed: true });
    d.runners.forEach((r, i) => {
      const y = .3 + i * (bottom - .3) / (n - 1), when = c.anchor(.04 + i * .055, r.at), winner = costs[i] === min;
      line(c, `lane${i}`, [start - .015, y + .06], [finish + .035, y + .06], when);
      text(c, `name${i}`, r.label, .07, y - .018, .035, when, { align: "left", maxW: .18, weight: "bold" });
      text(c, `cost${i}`, r.growth ?? `${r.time} ${d.unit}`, .07, y + .042, .027, when, { align: "left", maxW: .18, opacity: .55 });
      const id = visualAt(c, `runner${i}`, r, start, y, .11, when)
        ?? c.add({ id: c.id(`runner${i}`), type: "person", pose: "walk", x: start, y, size: .12 }, when, { style: "pop" });
      if (winner) { c.key(id); const obj = c.objects.find(o => o.id === id)!; if (obj.type !== "emoji") obj.color = ACCENT; }
      c.act({ at: startAt, do: "move", target: id, to: [start + (finish - start) * progress[i], y], duration: winner ? 1.1 : Math.min(2.2, 1.1 * 2 ** Math.min(2, costs[i] - min)), easing: "inOutSine" });
      if (winner) visualAt(c, `flag${i}`, { icon: "flag" }, finish + .075, y - .02, .065, finishAt);
      if (podium) {
        const rank = costs.filter(cost => cost < costs[i]).length + 1, x = .25 + i * .5 / Math.max(1, n - 1), h = .09 + (n - rank) * .025;
        shape(c, `podium${i}`, "rect", x, .94 - h / 2, .13, h, finishAt, { filled: winner, color: winner ? ACCENT : undefined });
        text(c, `podiumLabel${i}`, r.label, x, .94 - h - .035, .027, finishAt, { maxW: .13 });
        text(c, `rank${i}`, String(rank), x, .94 - h / 2, .035, finishAt, { color: winner ? "#000000" : undefined });
      }
    });
  },
  gauge(c, d, v) {
    head(c, d.label);
    const cx = v === "meter" ? .36 : .5, cy = .65, radius = v === "meter" ? .34 : .39;
    const zones = d.zones ?? [{ to: d.min + (d.max - d.min) / 2, label: "LOW" }, { to: d.max, label: "HIGH" }];
    const value = Math.max(d.min, Math.min(d.max, d.value)), theta = gaugeAngle(value, d.min, d.max);
    let from = d.min;
    zones.forEach((zone, i) => {
      const a = gaugeAngle(from, d.min, d.max), b = gaugeAngle(zone.to, d.min, d.max), when = frac(.04 + .06 * i);
      for (let j = 0; j < 12; j++) line(c, `arc${i}_${j}`, polar(a + (b - a) * j / 12, radius, cx, cy), polar(a + (b - a) * (j + 1) / 12, radius, cx, cy), when);
      const mid = polar((a + b) / 2, radius + .075, cx, cy);
      text(c, `zone${i}`, zone.label, mid[0], mid[1], .029, when, { maxW: .14 });
      line(c, `tick${i}`, polar(b, radius - .025, cx, cy), polar(b, radius + .015, cx, cy), when);
      from = zone.to;
    });
    text(c, "min", String(d.min), cx - radius * AR, cy + .065, .03, frac(0), { maxW: .14, opacity: .6 });
    text(c, "max", String(d.max), cx + radius * AR, cy + .065, .03, frac(0), { maxW: .14, opacity: .6 });
    const [swing, settle] = orderedAnchors(c.say, [.32, .73], []), r = radius * .82;
    const center = shape(c, "hub", "circle", cx, cy, .028 * AR, .028, frac(0), { filled: true, color: ACCENT });
    const initial = polar(Math.PI, r, cx, cy);
    const tip = shape(c, "tip", "circle", initial[0], initial[1], .007 * AR, .007, frac(0), { filled: true, color: ACCENT });
    c.key(line(c, "needle", center, tip, frac(0), { color: ACCENT }));
    // Overshoot stays within the dial even at either endpoint; the counter shows the actual supplied value.
    const overshoot = Math.min(2 * Math.PI, theta + Math.max(.06, Math.min(.12, (theta - Math.PI) * .1)));
    const path = Array.from({ length: 33 }, (_, i) => polar(Math.PI + (overshoot - Math.PI) * i / 32, r, cx, cy));
    c.act({ at: swing, do: "move", target: tip, path, duration: 1.2, easing: "outCubic" });
    c.act({ at: settle, do: "move", target: tip, path: Array.from({ length: 9 }, (_, i) => polar(overshoot + (theta - overshoot) * i / 8, r, cx, cy)), duration: MOTION.punchSec, easing: "outBack" });
    const decimals = Number.isInteger(d.value) ? 0 : 1;
    const digits = Math.max(formatCount(d.min, decimals, "", d.unit).length, formatCount(d.value, decimals, "", d.unit).length);
    const size = Math.min(.095, (v === "meter" ? .3 : .65) / (AR * digits));
    c.add({ id: c.id("value"), type: "counter", from: d.min, to: d.value, suffix: d.unit, decimals,
      x: v === "meter" ? .75 : .5, y: v === "meter" ? .48 : .82, size, color: ACCENT }, swing, { style: "stagger", duration: 1.2 });
    if (d.value < d.min || d.value > d.max) text(c, "overflow", d.value < d.min ? "BELOW RANGE" : "ABOVE RANGE", v === "meter" ? .75 : .5, v === "meter" ? .6 : .91, .028, settle, { maxW: .25, opacity: .6 });
  },
};
export const SAMPLES: Record<keyof T, unknown> = {
  scale: { title: "The hidden cost", left: { label: "Read", weight: 2, emoji: "📖" }, right: { label: "Write", weight: 5, emoji: "✍️" } },
  race: { title: "Same input. Different finish.", n: 16, runners: [{ label: "Binary search", growth: "log n", emoji: "🏃" }, { label: "Scan", growth: "n", icon: "user" }, { label: "Nested loops", growth: "n^2", emoji: "🐢" }] },
  gauge: { label: "Server load", value: 72, unit: "%", zones: [{ to: 40, label: "IDLE" }, { to: 80, label: "BUSY" }, { to: 100, label: "LIMIT" }] },
};
export const GUIDE = `- scale {title?,left:{label,weight,icon?|emoji?,at?},right:{...}} tip|balance. A physical trade-off; heavier pan drops, equal weights settle level.
- race {title?,n?,unit?,runners:[{label,growth?|time?,icon?|emoji?,at?}] 2-4} lanes|podium. Speed/latency; all growth (1|log n|n|n log n|n^2|2^n) or all positive times, lower wins.
- gauge {label,value,min?,max?,unit?,zones?:[{to,label}] 2-4} dial|meter. Load/risk: ordered zones end at max; needle clamps, counter keeps actual value.`;
