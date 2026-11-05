// Dev-only: ?showcase=<template>[&variant=..][&t=..][&prev=<template>&tr=whip|push|cut] renders one templated beat with
// fake word timings (no LLM/TTS). `prev` puts another template's beat first so the clear + transition are visible.
// window.__draw(t) / window.__total let a frame-capture script scrub the beat without reloading.
import { useEffect, useRef } from "react";
import Stage from "@/Stage";
import { compileOps } from "@motion/dsl/ops";
import { expandTemplates } from "@motion/dsl/templates";
import { Scene } from "@motion/dsl/schema";
import { SAMPLES } from "./samples";

export default function Showcase() {
  const q = new URLSearchParams(location.search);
  const name = q.get("showcase") ?? "title", sample = SAMPLES[name as keyof typeof SAMPLES];
  const prev = q.get("prev"), prevSample = prev ? SAMPLES[prev as keyof typeof SAMPLES] : undefined;
  const say = sample.say;
  const beat = { say, template: name, variant: q.get("variant") ?? undefined, data: sample.data, transition: q.get("tr") ?? undefined };
  const beats = prevSample ? [{ say: prevSample.say, template: prev, variant: q.get("pv") ?? undefined, data: prevSample.data }, beat] : [beat];
  const { scene, errors } = expandTemplates({ beats });
  const drawRef = useRef<((t: number) => void) | null>(null);
  const audio = beats.map((b) => {
    const words = b.say.split(/\s+/).map((w, i) => ({ word: w, start: i * .3, end: i * .3 + .25 }));
    return { words, duration: words.length * .3 };
  });
  const tl = scene ? compileOps(Scene.parse(scene), audio, 0) : null;
  const t = Number(q.get("t") ?? (tl ? tl.totalSec + 2 : 0));
  const timeRef = useRef(t);
  useEffect(() => {
    const w = window as unknown as { __draw?: (t: number) => void; __total?: number; __beat2?: number };
    w.__draw = (x) => { timeRef.current = x; drawRef.current?.(x); };
    w.__total = tl?.totalSec; w.__beat2 = tl?.events.find((e) => e.verb === "say" && e.beat === beats.length - 1)?.start;
    const h = setInterval(() => drawRef.current?.(timeRef.current), 200);
    return () => clearInterval(h);
  }, [t, tl, beats.length]);
  if (!scene || !tl) return <pre className="p-4 text-fg">{JSON.stringify(errors, null, 2)}</pre>;
  return <div className="grid h-screen place-items-center bg-bg [container-type:size]">
    <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))]"><Stage scene={Scene.parse(scene)} timeline={tl} drawRef={drawRef} timeRef={timeRef} /></div>
  </div>;
}
