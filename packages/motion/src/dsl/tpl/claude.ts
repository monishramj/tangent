// Human templates (claude): picture-first layouts (not box-and-arrow). Same contract as vocabTemplates.ts.
// iceberg: what you see vs what's underneath; stamp: a claim gets a verdict slammed on it; flipcard: question -> answer.
import { z } from "zod";
import { Pose } from "../schema";
import { ACCENT, MOTION } from "../../stage/motion";
import { type C, at, frac, orderedAnchors, s, spread, visual, visualAt } from "../tplkit";

const VERDICTS = { true: "TRUE", false: "FALSE", myth: "MYTH", fact: "FACT", wrong: "WRONG" } as const;
const short = (n: number) => s.max(n);

export const TEMPLATES = {
  iceberg: z.object({ top: z.object({ text: short(40), ...visual }), below: z.array(z.object({ text: short(40), ...at })).min(1).max(4) }),
  stamp: z.object({ claim: short(120), verdict: z.enum(["true", "false", "myth", "fact", "wrong"]), correction: short(80).optional(), ...at }),
  flipcard: z.object({ front: short(90), back: short(90), ...visual, pose: Pose.optional(), ...at }),
} as const;
type T = typeof TEMPLATES;
export const VARIANTS: Record<keyof T, string[]> = { iceberg: ["pan", "cutaway"], stamp: ["card", "slam"], flipcard: ["card", "duo"] };

const AR = 9 / 16; // stage width per stage height
const text = (c: C, base: string, t: string, x: number, y: number, size: number, when: string, o: Record<string, unknown> = {}) =>
  c.add({ id: c.id(base), type: "text", text: t, x, y, size, ...o }, when, { style: "type" });

/** Iceberg geometry (stage fractions; y may run below 1 in "pan", where the camera follows). cams[i] = camera y when layer i lands. */
export function icebergLayout(n: number, v: string) {
  const pan = v === "pan", water = pan ? .5 : .3, tipH = pan ? .2 : .16;
  const pitch = pan ? .28 : Math.min(.24, (.95 - water - .04) / n), h = pitch - .03;
  const layers = Array.from({ length: n }, (_, i) => ({ y: water + (pan ? .2 : .04 + pitch / 2) + i * pitch, h, w: Math.min(.84, .3 + (pan ? .16 : .14) * i) }));
  const cams = layers.map(l => pan ? Math.max(.5, l.y - .3) : .5);
  return { water, tip: { y: water - tipH / 2, h: tipH, w: tipH * 1.4 * AR }, layers, cams, depth: layers[n - 1].y + h / 2 + .1 - water };
}

/** Claim text size (stage heights) shrinks with length so 120 chars still fit the card in 3-4 lines. */
export const claimSize = (len: number) => len <= 30 ? .066 : len <= 60 ? .054 : .044;
/** Stamp border around a bold all-caps word at font size `size` (stage heights); width in stage widths. */
/** Card face text size (stage heights) from the longer face, so 90 chars fit the card in <= 4 lines. */
export const faceSize = (len: number) => len <= 24 ? .07 : len <= 50 ? .056 : .045;
export const stampBox = (word: string, size: number) => ({ w: word.length * size * .68 * AR + .07, h: size * 1.5 });

export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {
  iceberg(c, d, v) {
    const L = icebergLayout(d.below.length, v), pan = v === "pan";
    c.add({ id: c.id("ice_sea"), type: "shape", shape: "rect", ghost: true, x: .5, y: L.water + L.depth / 2, width: 1.2, height: L.depth }, frac(0), { style: "slide", edge: "bottom" });
    c.add({ id: c.id("ice_water"), type: "line", from: [-.02, L.water], to: [1.02, L.water] }, frac(0), { style: "draw", duration: .7 });
    const [tTip, tBob] = orderedAnchors(c.say, [.04, .14], []);
    const tip = c.add({ id: c.id("ice_tip"), type: "shape", shape: "triangle", filled: true, x: .5, y: L.tip.y, width: L.tip.w, height: L.tip.h }, tTip, { style: "pop" });
    if (tBob !== tTip) c.act({ at: tBob, do: "move", target: tip, path: [[.5, L.tip.y], [.5, L.tip.y - .02], [.5, L.tip.y]], duration: 1.4, easing: "inOutSine" }); // a slow bob
    const ty = L.tip.y - L.tip.h * .1;
    visualAt(c, "ice_top_v", d.top, .5 - L.tip.w / 2 - .06, ty, pan ? .12 : .1, frac(.08));
    text(c, "ice_top", d.top.text, .5 + L.tip.w / 2 + .03, ty, pan ? .05 : .044, frac(.08), { weight: "bold", opacity: 1, align: "left", maxW: .3 });
    if (!pan) c.add({ id: c.id("ice_depth"), type: "arrow", from: [.07, L.water + .05], to: [.07, .94], dashed: true }, frac(.2), { style: "draw", duration: 2.5 });
    const when = orderedAnchors(c.say, spread(L.layers.length, .25, .85), d.below.map(b => b.at)), ids: string[] = [];
    L.layers.forEach((l, i) => {
      ids.push(c.add({ id: c.id(`ice_layer${i}`), type: "shape", shape: "rect", label: d.below[i].text, x: .5, y: l.y, width: l.w, height: l.h }, when[i], { style: "slide", edge: "bottom", duration: .5 }));
      if (pan && L.cams[i] !== (i ? L.cams[i - 1] : .5)) c.act({ at: when[i], do: "camera", y: L.cams[i], duration: .8, easing: "inOutCubic" });
    });
    c.key(ids[ids.length - 1]);
  },
  stamp(c, d, v) {
    const word = VERDICTS[d.verdict], bad = d.verdict === "false" || d.verdict === "myth" || d.verdict === "wrong", slam = v === "slam";
    const [t0, tStamp, tMark, tFix] = orderedAnchors(c.say, [0, .4, .55, .66], [undefined, d.at ?? d.verdict, undefined, undefined]); // stamp never on the claim's first word
    const claim = `“${d.claim}”`, size = claimSize(d.claim.length);
    let claimId: string;
    if (slam) claimId = c.add({ id: c.id("stamp_claim"), type: "KineticText", text: claim, variant: "words", x: .5, y: .42, size: size * 1.2, maxW: .8 }, t0);
    else {
      c.add({ id: c.id("stamp_card"), type: "shape", shape: "rect", x: .5, y: .42, width: .72, height: .44 }, frac(0), { style: "draw", duration: .6 });
      claimId = text(c, "stamp_claim", claim, .5, .37, size, t0, { opacity: 1, maxW: .62 });
    }
    const ss = slam ? .15 : .1, box = stampBox(word, ss), [sx, sy, rot] = slam ? [.5, .6, -.12] : [.68, .58, -.22];
    if (slam && tStamp !== t0) c.act({ at: tStamp, do: "move", target: claimId, to: [.5, .25], duration: .4, easing: "outExpo" });
    c.add({ id: c.id("stamp_box"), type: "shape", shape: "rect", x: sx, y: sy, width: box.w, height: box.h, color: ACCENT, rotation: rot }, tStamp, { style: "stamp", duration: .45 });
    c.key(c.add({ id: c.id("stamp_word"), type: "text", text: word, x: sx, y: sy, size: ss, weight: "bold", opacity: 1, color: ACCENT, rotation: rot }, tStamp, { style: "stamp", duration: .45 }));
    c.act({ at: tStamp, do: "camera", shake: slam ? .03 : .02, duration: .45 });
    if (bad) c.add({ id: c.id("stamp_strike"), type: "mark", target: claimId, mark: "strike" }, tMark, { style: "draw", duration: .45 });
    if (d.correction) text(c, "stamp_fix", `${bad ? "→" : "✓"} ${d.correction}`, .5, slam ? .86 : .84, .046, tFix, { opacity: .9, maxW: .8 });
  },
  flipcard(c, d, v) {
    const duo = v === "duo", x = duo ? .62 : .5, w = duo ? .46 : .5, y = .54, hgt = .56;
    const [t0, tFlip, tAfter] = orderedAnchors(c.say, [0, .45, .7], [undefined, d.at, undefined]); // flip never on the card's first word
    if (duo) c.add({ id: c.id("flip_person"), type: "person", pose: d.pose ?? "think", facing: "right", x: .2, y: .62, size: .5 }, frac(0), { style: "draw", duration: .6 });
    visualAt(c, "flip_v", d, x, .14, .1, frac(.08));
    const size = faceSize(Math.max(d.front.length, d.back.length)), face = { x, y, size, weight: "bold", maxW: w * .82 };
    const front = c.add({ id: c.id("flip_front"), type: "shape", shape: "rect", x, y, width: w, height: hgt }, t0, { style: "pop" });
    const frontT = c.add({ id: c.id("flip_front_t"), type: "text", text: d.front, opacity: 1, ...face }, t0, { style: "pop" });
    if (tFlip !== t0) for (const id of [front, frontT]) c.act({ at: tFlip, do: "transform", target: id, scaleX: 0, duration: .22, easing: "inOutQuad" });
    c.add({ id: c.id("flip_back"), type: "shape", shape: "rect", filled: true, x, y, width: w, height: hgt }, tFlip, { style: "flip", duration: .44 });
    c.key(c.add({ id: c.id("flip_back_t"), type: "text", text: d.back, opacity: 1, color: "#000000", ...face }, tFlip, { style: "flip", duration: .44 }));
    c.act({ at: tFlip, do: "camera", zoom: MOTION.energy.punchy.zoom - .02, duration: .5, easing: "outExpo" });
    if (duo && tAfter !== tFlip) c.act({ at: tAfter, do: "pose", target: "flip_person", to: "point" });
  },
};

export const SAMPLES: Record<keyof T, unknown> = {
  iceberg: { top: { text: "Your code", icon: "laptop" }, below: [{ text: "Compiler", at: "parent" }, { text: "Operating system" }, { text: "Hardware", at: "swaps" }] },
  stamp: { claim: "Heaps are fully sorted arrays", verdict: "myth", correction: "Only the parent beats its children" },
  flipcard: { front: "Which child swaps up?", back: "The bigger one", emoji: "🤔", at: "bigger child" },
};

export const GUIDE = `- iceberg {top:{text, icon?|emoji?}, below:[{text, at?}] 1-4} pan|cutaway. What you see vs what's underneath: abstractions, hidden costs, layers below an API.
- stamp {claim, verdict:"true"|"false"|"myth"|"fact"|"wrong", correction?, at?} card|slam. A claim gets a verdict stamped on it: misconceptions, common mistakes.
- flipcard {front, back, icon?|emoji?, pose?, at?} card|duo. Question card flips to the answer at "at": quick quiz, "what do you think happens?".`;
