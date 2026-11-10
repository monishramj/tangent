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
export const VARIANTS: Record<keyof T, string[]> = { fill: ["glass", "battery", "bar"], pictograph: ["grid", "sweep"], dominoes: ["row", "arc"], chat: ["phone", "bubbles"] };
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

export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {
  fill(c, d, v) {
    const { level, overflow, percent } = fillLevel(d.amount, d.capacity), bar = v === "bar";
    const x = .42, y = .53, w = bar ? .6 : .23, h = bar ? .17 : .49;
    text(c, "fill_label", d.label, .5, .12, .055, frac(0), { weight: "bold" });
    shape(c, "fill_shell", x, y, w + .014, h + .024, frac(.02), { shape: v === "glass" ? "trapezoid" : "rect" });
    if (v === "battery") shape(c, "fill_terminal", x, y - h / 2 - .028, w * .35, .026, frac(.03), { filled: true });
    // shortcut: fill reveals in 32 bands; use a masked primitive when continuous liquid motion is needed.
    const bands = Math.ceil(level * 32), innerW = v === "glass" ? w * .7 : w * .9, innerH = h * .9;
    for (let i = 0; i < bands; i++) {
      const a = i / 32, b = Math.min(level, (i + 1) / 32), when = frac(.16 + .48 * a);
      const id = shape(c, "fill_liquid", bar ? x - innerW / 2 + innerW * (a + b) / 2 : x,
        bar ? y : y + innerH / 2 - innerH * (a + b) / 2,
        bar ? innerW * (b - a) : innerW, bar ? innerH : innerH * (b - a), when, { filled: true, color: ACCENT });
      c.key(id);
    }
    const counter = c.add({ id: c.id("fill_percent"), type: "counter", from: 0, to: percent, suffix: "%", size: .095, x: bar ? .5 : .83, y: bar ? .72 : .5, color: ACCENT }, frac(.16), { duration: 1.3 });
    c.key(counter);
    text(c, "fill_amount", `${d.amount} / ${d.capacity}${d.unit ? " " + d.unit : ""}`, .5, .87, .04, frac(.18));
    c.add({ id: c.id("fill_capacity"), type: "line", from: bar ? [x + innerW / 2, y - h * .7] : [x - w * .55, y - innerH / 2], to: bar ? [x + innerW / 2, y + h * .7] : [x + w * .55, y - innerH / 2], dashed: true }, frac(.08), { style: "draw" });
    text(c, "fill_caplabel", "CAPACITY", bar ? .74 : x, bar ? .31 : .23, .025, frac(.08), { maxW: .2, opacity: .6 });
    visualAt(c, "fill_icon", d, .83, .28, .09, frac(.04));
    if (overflow > 0) {
      for (let i = 0; i < 5; i++) {
        const start: [number, number] = [bar ? x + w / 2 : x + innerW / 2, bar ? y : y - innerH / 2];
        const id = shape(c, "fill_drop", start[0], start[1], .018 * AR, .025, frac(.68 + i * .035), { shape: "circle", filled: true, color: ACCENT });
        c.act({ at: frac(.69 + i * .035), do: "move", target: id, path: [start, [start[0] + .045, start[1] - .03], [start[0] + .09, .77]], duration: .6, easing: "inExpo" });
      }
      text(c, "fill_overflow", `+${Number(overflow.toPrecision(5))}${d.unit ? " " + d.unit : ""} overflow`, .81, .85, .032, frac(.8), { color: ACCENT, maxW: .28 });
    }
  },
  pictograph(c, d, v) {
    const { cols, rows, cell } = pictographGrid(d.n), times = spread(d.k, .2, .76);
    text(c, "pic_label", d.label, .5, .1, .052, frac(0), { weight: "bold" });
    for (let i = 0; i < d.n; i++) {
      const row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, d.n - row * cols);
      const x = .5 + (col - (inRow - 1) / 2) * cell * AR, y = .47 + (row - (rows - 1) / 2) * cell;
      const when = frac(v === "sweep" ? .2 + .56 * col / Math.max(1, cols - 1) : times[i] ?? .2);
      // A backing disc also gives colour emoji an unambiguous accent selection.
      if (i < d.k) shape(c, "pic_lit", x, y, cell * .86 * AR, cell * .86, when, { shape: "circle", filled: true, color: ACCENT });
      const id = visualAt(c, "pic_icon", d.emoji || d.icon ? d : { icon: "user" }, x, y, cell * .57, frac(.02 + .08 * row / Math.max(1, rows)), undefined)!;
      c.act({ at: frac(.12), do: "fade", target: id, to: .32, duration: .08 });
      if (i < d.k) {
        c.key(id);
        c.act({ at: when, do: "fade", target: id, to: 1, duration: .15 });

      } else c.key(id);
    }
    c.add({ id: c.id("pic_percent"), type: "counter", from: 0, to: d.k / d.n * 100, decimals: 1, suffix: "%", x: .5, y: .83, size: .095, color: ACCENT }, frac(.2), { duration: 1.4 });
    text(c, "pic_ratio", `${d.k} in ${d.n}`, .5, .94, .032, frac(.25), { opacity: .65 });
  },
  dominoes(c, d, v) {
    if (d.title) text(c, "dom_title", d.title, .5, .1, .05, frac(0), { weight: "bold" });
    const n = d.items.length, gap = .7 / n, h = Math.min(.44, gap / AR * 1.25), w = .032;
    const anchors = orderedAnchors(c.say, spread(n, .2, .83), d.items.map(it => it.at));
    d.items.forEach((it, i) => {
      const x = .1 + i * gap, base = .73 - (v === "arc" ? .08 * Math.sin(i / (n - 1) * Math.PI) : 0), angle = Math.acos(Math.min(.95, w / (h * AR))) * .92;
      const id = shape(c, "dom_body", x, base - h / 2, w, h, frac(.025 * i), { filled: true, pivot: "bottom", color: i === n - 1 ? ACCENT : "#ffffff" });
      if (i === n - 1) c.key(id);
      c.act({ at: anchors[i], do: "transform", target: id, rotate: angle, duration: .48, easing: "inExpo" });
      text(c, "dom_label", short(it.text, 38), x + gap * .25, .87, .033, frac(.03 * i), { maxW: gap * .95, opacity: .85 });
      const icon = visualAt(c, "dom_icon", it, x, base - h - .08, .065, frac(.03 * i));
      if (icon) c.act({ at: anchors[i], do: "indicate", target: icon, duration: MOTION.punchSec });
    });
    if (v === "row") c.add({ id: c.id("dom_floor"), type: "line", from: [.06, .73], to: [.91, .73] }, frac(0), { style: "draw" });
  },
  chat(c, d, v) {
    const phone = v === "phone", w = phone ? .55 : .86, left = .5 - w / 2, right = .5 + w / 2;
    if (phone) {
      shape(c, "chat_phone", .5, .5, .62, .94, frac(0), { shape: "pill" });
      shape(c, "chat_speaker", .5, .07, .08, .009, frac(.02), { shape: "pill", filled: true });
    }
    for (const [side, party] of [["left", d.left], ["right", d.right]] as const) {
      const x = side === "left" ? left + .07 : right - .07;
      visualAt(c, "chat_avatar", party.icon || party.emoji ? party : { icon: "user" }, x, .16, .07, frac(.02));
      text(c, "chat_name", short(party.name, 24), x, .235, .028, frac(.04), { maxW: w * .4, weight: "bold" });
    }
    const anchors = orderedAnchors(c.say, spread(d.messages.length, .18, .85), d.messages.map(m => m.at));
    const rh = .61 / d.messages.length;
    d.messages.forEach((m, i) => {
      const isLeft = m.from === "left", bw = w * .72, x = isLeft ? left + bw / 2 + .015 : right - bw / 2 - .015, y = .32 + rh * (i + .5);
      if (m.typing) {
        const id = text(c, "chat_typing", "• • •", x, y, .032, c.anchor(Math.max(.07, .18 + .67 * i / (d.messages.length - 1) - .07)), { maxW: bw, opacity: .6 });
        c.act({ at: anchors[i], do: "fade", target: id, to: 0, duration: .08 });
      }
      const bubble = c.add({ id: c.id("chat_message"), type: "shape", shape: "bubble", label: short(m.text, 90), tail: m.from, x, y, width: bw, height: rh * .78, color: isLeft ? "#ffffff" : ACCENT }, anchors[i], { style: "slide", edge: m.from, duration: MOTION.punchSec, easing: "outCubic" });
      c.key(bubble);
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
- dominoes {title?,items:[{text,icon?|emoji?,at?}] 3-6} row|arc. Physical cause/effect cascade, replacing flowcharts.
- chat {left:{name,icon?|emoji?},right:{...},messages:[{from:"left"|"right",text,at?,typing?}] 2-6} phone|bubbles. Requests, protocols, handshakes.`;
