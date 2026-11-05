// Builders for icon / emoji / counter / person (Pixi) and gif (HTML overlay). Each returns {node, draw}; draw may return
// the drawn half-extents (px, unscaled) so the renderer can trim arrows and size tutor annotations.
import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SceneObject } from "../dsl/schema";
import type { ObjState } from "./scene";
import { FONT, strokePath } from "./visuals";
import { counterValue, formatCount } from "./geometry";
import { iconSvg, resolveIcon } from "./icons";
import { PERSON_PARTS, jointsAt, personParts } from "./person";
import { ease, staggerProgress } from "./motion";

type Cell = { cw?: number; ch?: number } | undefined;
type O<T extends string> = Extract<SceneObject, { type: T }>;
type Ext = [number, number];
const cap = (px: number, cell: Cell, fx = .9, fy = .8) => Math.min(px, cell?.cw ? cell.cw * fx : Infinity, cell?.ch ? cell.ch * fy : Infinity);
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function txt(node: Container, text: string, fill: string, bold = false, family = FONT) {
  const t = new Text({ text, style: { fill, fontFamily: family, fontWeight: bold ? "bold" : "normal", fontSize: 28 } });
  t.anchor.set(.5); node.addChild(t); return t;
}
function caption(t: Text, text: string, size: number, y: number, alpha: number) {
  if (t.text !== text) t.text = text;
  t.style.fontSize = size; t.position.set(0, y); t.alpha = alpha * .6;
}

export function buildIcon(o: O<"icon">, fg: string, cell: () => Cell) {
  const node = new Container(), g = new Graphics(), label = txt(node, o.label ?? "", fg);
  node.addChildAt(g, 0);
  try { g.svg(iconSvg(resolveIcon(o.name), fg)); }
  catch { g.clear(); g.circle(12, 12, 9).stroke({ color: fg, width: 1.5 }); }
  g.pivot.set(12, 12);
  return { node, draw(s: ObjState, _w: number, h: number): Ext {
    const S = cap((o.size ?? .14) * h, cell(), .9, o.label ? .7 : .9), r = s.style === "draw" ? s.reveal ?? 1 : 1;
    g.scale.set(S / 24 * (.8 + .2 * ease(r))); g.alpha = r;
    caption(label, o.label ?? "", Math.max(10, S * .22), S * .72, r);
    return [S / 2, S / 2];
  } };
}

export function buildEmoji(o: O<"emoji">, fg: string, cell: () => Cell) {
  const node = new Container(), t = txt(node, o.char, fg, false, EMOJI), label = txt(node, o.label ?? "", fg);
  return { node, draw(_s: ObjState, _w: number, h: number): Ext {
    const S = cap((o.size ?? .16) * h, cell(), .9, o.label ? .7 : .9);
    node.tint = 0xffffff; // colour emoji ignore tint
    t.style.fontSize = S;
    caption(label, o.label ?? "", Math.max(10, S * .2), S * .7, 1);
    return [S / 2, S / 2];
  } };
}

export function buildCounter(o: O<"counter">, fg: string, cell: () => Cell) {
  // One retained Text per character on fixed digit slots: rolling digits never shift the number sideways.
  // The string is right-aligned to the final value's width, so new leading digits grow to the left.
  const node = new Container(), label = txt(node, o.label ?? "", fg), chars: Text[] = [];
  const final = formatCount(o.to, o.decimals, o.prefix, o.suffix), start = formatCount(o.from, o.decimals, o.prefix, o.suffix);
  const widest = Math.max(final.length, start.length);
  let fs0 = 0, adv = new Map<string, number>();
  const width = (s: string) => [...s].reduce((a, ch) => a + adv.get(/\d/.test(ch) ? "0" : ch)!, 0);
  return { node, draw(s: ObjState, _w: number, h: number): Ext {
    const c = cell(), fs = Math.min((o.size ?? .2) * h, c?.cw ? c.cw * .9 / (widest * .62) : Infinity, c?.ch ? c.ch * .7 : Infinity);
    const text = formatCount(counterValue(o.from, o.to, s.reveal ?? 1), o.decimals, o.prefix, o.suffix);
    if (fs !== fs0) { // measure once per size: the widest digit is every digit's slot
      fs0 = fs;
      const style = new TextStyle({ fontFamily: FONT, fontWeight: "bold", fontSize: fs });
      adv = new Map([...new Set(final + start + text + "0123456789")].map(ch => [ch, CanvasTextMetrics.measureText(ch, style).width]));
      adv.set("0", Math.max(...[..."0123456789"].map(d => adv.get(d)!)));
      for (const [ch, v] of adv) adv.set(ch, v - fs * .04); // tight display tracking
      chars.forEach(t => { t.style.fontSize = fs; });
    }
    for (const ch of text) if (!adv.has(ch)) adv.set(ch, fs * .6);
    while (chars.length < text.length) chars.push(txt(node, "", fg, true));
    const W = Math.max(width(final), width(start));
    let x = W / 2 - width(text);
    chars.forEach((t, i) => {
      t.visible = i < text.length;
      if (!t.visible) return;
      const ch = text[i], a = adv.get(/\d/.test(ch) ? "0" : ch)!;
      if (t.text !== ch) t.text = ch;
      if (t.style.fontSize !== fs) t.style.fontSize = fs;
      t.position.set(x + a / 2, 0); x += a;
    });
    caption(label, o.label ?? "", Math.max(10, h * .035), fs * .75, 1);
    return [W / 2, fs * .6];
  } };
}

export function buildPerson(o: O<"person">, fg: string, cell: () => Cell) {
  const node = new Container(), g = new Graphics(), q = txt(node, "?", fg, true), label = txt(node, o.label ?? "", fg);
  node.addChildAt(g, 0);
  return { node, draw(s: ObjState, _w: number, h: number): Ext {
    const H = cap((o.size ?? .38) * h, cell(), .9, o.label ? .85 : .95), dir = o.facing === "left" ? -1 : 1, age = s.age ?? 0, k = s.poseP ?? 1;
    const { parts, head, headR } = personParts(jointsAt(s.pose, s.poseFrom, k, age), H, o.facing);
    const has = (name: string) => Math.min(1, (s.pose === name ? k : 0) + (s.poseFrom === name ? 1 - k : 0));
    const draw = s.style === "draw", lw = .012 * h;
    g.clear(); g.y = Math.sin(age * 2) * H * .004;
    parts.forEach((p, i) => strokePath(g, p, draw ? staggerProgress(s.reveal ?? 1, i, PERSON_PARTS, .12) : 1, fg, lw, 1, true));
    if (!draw || (s.reveal ?? 1) >= 1) g.circle(head[0] + dir * headR * .35, head[1] - headR * .1, headR * .1).fill({ color: fg });
    const think = has("think");
    if (think > 0) [[1.5, -1.5, .14], [2.1, -2.2, .22], [2.9, -3.1, .4]].forEach(([dx, dy, r]) =>
      g.circle(head[0] + dir * headR * dx, head[1] + headR * dy, headR * r).stroke({ color: fg, width: lw * .6, alpha: think }));
    const conf = has("confused");
    q.visible = conf > 0; q.alpha = conf; q.style.fontSize = H * .12;
    q.position.set(head[0] + dir * headR * .2, head[1] - headR * 2.2 + Math.sin(age * 4) * H * .01);
    caption(label, o.label ?? "", Math.max(10, h * .03), H / 2 + h * .035, 1);
    return [H * .3, H / 2];
  } };
}

/** Framed gif card in the HTML overlay. No src (no API key): a bold reaction-card placeholder showing the query/caption. */
export function buildGif(o: O<"gif">, layer: HTMLElement, cell: () => Cell) {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;transform-origin:center;display:none;pointer-events:none";
  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;inset:0;border:1px solid rgba(255,255,255,.2);border-radius:12px;overflow:hidden;background:#0a0a0a;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 8%;box-sizing:border-box";
  const big = o.query ?? o.caption ?? "GIF", shown = o.src ? "" : big;
  const placeholder = () => { frame.textContent = big; frame.style.cssText += ";font-weight:800;letter-spacing:-.03em;line-height:1.05;color:var(--fg)"; };
  if (o.src) {
    const img = document.createElement("img");
    img.src = o.src; img.alt = o.caption ?? o.query ?? "";
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
    img.onerror = () => { img.remove(); placeholder(); };
    frame.appendChild(img);
  } else placeholder();
  const vignette = document.createElement("div");
  vignette.style.cssText = "position:absolute;inset:0;border-radius:12px;box-shadow:inset 0 0 60px rgba(0,0,0,.6);pointer-events:none";
  const cap = document.createElement("div");
  const text = o.caption && o.caption !== shown ? o.caption : "";
  cap.textContent = text;
  cap.style.cssText = "position:absolute;left:0;right:0;top:100%;margin-top:10px;text-align:center;color:var(--fg);opacity:.7;font-weight:600";
  el.append(frame, vignette, cap);
  layer.appendChild(el);
  return { node: el as HTMLElement, draw(s: ObjState, w: number, h: number): Ext {
    const c = cell();
    const bw = Math.min((o.width ?? .42) * w, c?.cw ? c.cw * .95 : Infinity), bh = Math.min((o.height ?? .42) * h, c?.ch ? c.ch * (text ? .8 : .95) : Infinity);
    el.style.display = s.visible ? "block" : "none";
    el.style.opacity = String(s.opacity);
    el.style.width = `${bw}px`; el.style.height = `${bh}px`;
    el.style.left = `${s.x * w}px`; el.style.top = `${s.y * h}px`;
    el.style.transform = `translate(-50%,-50%) scale(${s.scale}) rotate(${s.rotation ?? 0}rad)`;
    frame.style.fontSize = `${Math.min(bh * .22, bw * .12)}px`;
    cap.style.fontSize = `${h * .03}px`;
    return [bw / 2, bh / 2];
  } };
}
