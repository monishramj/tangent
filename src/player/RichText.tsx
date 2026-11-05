import { Fragment, useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export type Piece = { kind: "text"; text: string } | { kind: "math"; tex: string; display: boolean };

/**
 * Split text into plain runs and `$…$` / `$$…$$` math. `\$` is a literal dollar. Inline math must not start or end
 * with a space and must not be followed by a digit, so "costs $5 and $10" stays text.
 */
export function splitMath(src: string): Piece[] {
  const out: Piece[] = [];
  let text = "";
  const flush = () => { if (text) out.push({ kind: "text", text }); text = ""; };
  for (let i = 0; i < src.length;) {
    if (src[i] === "\\" && src[i + 1] === "$") { text += "$"; i += 2; continue; }
    if (src[i] === "$") {
      const display = src[i + 1] === "$";
      const open = display ? 2 : 1;
      const end = findClose(src, i + open, display);
      if (end > i + open) {
        const tex = src.slice(i + open, end);
        if (display || (!/^\s/.test(tex) && !/\s$/.test(tex) && !/\d/.test(src[end + 1] ?? ""))) {
          flush(); out.push({ kind: "math", tex: tex.trim(), display }); i = end + open; continue;
        }
      }
    }
    text += src[i]; i++;
  }
  flush();
  return out;
}

function findClose(src: string, from: number, display: boolean): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === "\n" && src[j + 1] === "\n") return -1; // math never spans a paragraph
    if (src[j] === "$" && (!display || src[j + 1] === "$")) return j;
  }
  return -1;
}

const toHtml = (tex: string, display: boolean) => {
  try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "html" }); }
  catch { return null; }
};

/** Tutor text: plain runs are React text (never HTML); only KaTeX output is injected. Line breaks are kept. */
export default function RichText({ text, className = "" }: { text: string; className?: string }) {
  const pieces = useMemo(() => splitMath(text), [text]);
  return (
    <span className={`rich whitespace-pre-line ${className}`}>
      {pieces.map((p, i) => {
        if (p.kind === "text") return <Fragment key={i}>{p.text}</Fragment>;
        const html = toHtml(p.tex, p.display);
        if (html === null) return <Fragment key={i}>{p.display ? `$$${p.tex}$$` : `$${p.tex}$`}</Fragment>;
        return <span key={i} data-math className={p.display ? "block" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}
