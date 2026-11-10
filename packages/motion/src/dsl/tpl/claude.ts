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

/** Iceberg geometry (stage fractions; y runs below 1 in "pan", where the camera follows). The submerged mass is a tall
 * hexagon (flat top at the waterline, half as wide as its middle) with the tip a triangle on that flat top, so the two read
 * as one berg. Layer labels sit inside the mass; maxW is the berg's width at that depth. cams[i] = camera y when layer i
 * lands; end = the pull-back camera that shows the whole berg (pan). */
export function icebergLayout(n: number, v: string) {
  const pan = v === "pan", water = pan ? .5 : .3, tipH = pan ? .22 : .2, W = pan ? .62 : .54;
  const depth = pan ? .3 * n + .08 : .65, wAt = (u: number) => W / 2 * (2 - Math.abs(2 * u - 1)); // berg width at depth fraction u
  const layers = Array.from({ length: n }, (_, i) => { const u = pan ? (.04 + .3 * (i + .5)) / depth : (i + .5) / n; return { y: water + u * depth, maxW: wAt(u) * .82 }; });
  const strata = Array.from({ length: n - 1 }, (_, i) => { const y = (layers[i].y + layers[i + 1].y) / 2, u = (y - water) / depth; return { y, w: wAt(u) * .8 }; });
  const cams = layers.map(l => pan ? Math.max(.5, l.y - .22) : .5);
  const climber = pan ? .1 : 0; // pan: a tiny figure stands on the apex (height in stage heights)
  const top = water - tipH - climber - .06, bottom = water + depth + .05, zoom = Math.min(1, 1 / (bottom - top));
  return { water, tip: { y: water - tipH / 2, h: tipH, w: W / 2 }, mass: { y: water + depth / 2, h: depth, w: W }, layers, strata, cams, depth, climber,
    end: { y: zoom < 1 ? (top + bottom) / 2 : Math.max(.5, bottom - .5), zoom } };
}

/** Claim text size (stage heights) shrinks with length so 120 chars still fit the card in 3-4 lines. */
export const claimSize = (len: number) => len <= 30 ? .066 : len <= 60 ? .054 : .044;
/** Card face text size (stage heights) from the longer face, so 90 chars fit the card in <= 4 lines. */
export const faceSize = (len: number) => len <= 24 ? .07 : len <= 50 ? .056 : .045;
/** Stamp border around a bold all-caps word at font size `size` (stage heights); width in stage widths. */
export const stampBox = (word: string, size: number) => ({ w: word.length * size * .68 * AR + .07, h: size * 1.5 });

export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {
  iceberg(c, d, v) {
    const L = icebergLayout(d.below.length, v), pan = v === "pan", ts = pan ? .05 : .042;
    c.add({ id: c.id("ice_sea"), type: "shape", shape: "rect", ghost: true, x: .5, y: L.water + 1, width: 3, height: 2 }, frac(0), { style: "slide", edge: "bottom" });
    c.add({ id: c.id("ice_water"), type: "line", from: [-1, L.water], to: [2, L.water] }, frac(0), { style: "draw", duration: .7 });
    const [tTip, tBob, tLook] = orderedAnchors(c.say, [.04, .14, .2], []);
    const tip = c.add({ id: c.id("ice_tip"), type: "shape", shape: "triangle", filled: true, x: .5, y: L.tip.y, width: L.tip.w, height: L.tip.h }, tTip, { style: "pop" });
    // pan: a tiny climber stands on the summit (feet on the apex, bobbing with the tip) and looks confused as the hidden mass
    // appears. cutaway's apex sits too close to the frame top for a readable figure, so it has none.
    const fh = L.climber, fy = L.tip.y - L.tip.h / 2 - fh / 2;
    const climber = pan ? c.add({ id: c.id("ice_person"), type: "person", pose: "stand", facing: "right", x: .5, y: fy, size: fh }, tTip, { style: "pop" }) : undefined;
    if (tBob !== tTip) for (const [id, y] of [[tip, L.tip.y], [climber, fy]] as const)
      if (id) c.act({ at: tBob, do: "move", target: id, path: [[.5, y], [.5, y - .015], [.5, y]], duration: 1.4, easing: "inOutSine" }); // a slow bob
    if (climber && tLook !== tBob && tLook !== tTip) c.act({ at: tLook, do: "pose", target: climber, to: "confused" });
    const ty = L.tip.y + L.tip.h * .15;
    visualAt(c, "ice_top_v", d.top, .5 - L.tip.w / 2 - .07, ty, pan ? .12 : .1, frac(.08));
    text(c, "ice_top", d.top.text, .5 + L.tip.w / 2 + .03, ty, ts * 1.1, frac(.08), { weight: "bold", opacity: 1, align: "left", maxW: .28 });
    // the hidden mass traces in under the waterline: the "oh, it's huge" moment
    c.add({ id: c.id("ice_mass"), type: "shape", shape: "hexagon", ghost: true, x: .5, y: L.mass.y, width: L.mass.w, height: L.mass.h }, frac(.16), { style: "draw", duration: pan ? 1.6 : 1.2 });
    if (!pan) c.add({ id: c.id("ice_depth"), type: "arrow", from: [.1, L.water + .05], to: [.1, .94], dashed: true }, frac(.2), { style: "draw", duration: 2.5 });
    const when = orderedAnchors(c.say, spread(L.layers.length, .24, .72), d.below.map(b => b.at)), last = L.layers.length - 1;
    L.strata.forEach((st, i) => c.add({ id: c.id(`ice_strata${i}`), type: "line", from: [.5 - st.w / 2, st.y], to: [.5 + st.w / 2, st.y], dashed: true }, when[i + 1], { style: "draw", duration: .5 }));
    L.layers.forEach((l, i) => {
      const id = text(c, `ice_layer${i}`, d.below[i].text, .5, l.y, ts, when[i], { weight: i === last ? "bold" : "normal", opacity: 1, maxW: l.maxW, ...(i === last ? { color: ACCENT } : {}) });
      if (i === last) c.key(id);
      if (pan && L.cams[i] !== (i ? L.cams[i - 1] : .5)) c.act({ at: when[i], do: "camera", y: L.cams[i], duration: .8, easing: "inOutCubic" });
    });
    const tEnd = orderedAnchors(c.say, [...spread(L.layers.length, .24, .72), .84], [...d.below.map(b => b.at), undefined])[L.layers.length];
    if (pan && (L.end.zoom < 1 || L.end.y !== L.cams[last])) c.act({ at: tEnd, do: "camera", y: L.end.y, zoom: L.end.zoom, duration: 1, easing: "inOutCubic" }); // pull back: the whole berg
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
    // slam: once the claim has moved up, a figure beside the stamp reacts to the verdict
    if (slam) {
      const react = bad ? "confused" : "celebrate", later = tFix !== tMark; // short narration: no room to react, start in the pose
      const me = c.add({ id: c.id("stamp_person"), type: "person", pose: later ? "stand" : react, facing: "right", x: .2, y: .66, size: .26 }, tMark, { style: "pop" });
      if (later) c.act({ at: tFix, do: "pose", target: me, to: react });
    }
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
