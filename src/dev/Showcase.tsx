// Dev-only: ?showcase=<template>[&variant=..][&t=..] renders one templated beat with fake word timings (no LLM/TTS).
import { useEffect, useRef } from "react";
import Stage from "@/Stage";
import { compileOps } from "@/dsl/ops";
import { expandTemplates } from "@/dsl/templates";
import { Scene } from "@/dsl/schema";
import { SAMPLES } from "./samples";

export default function Showcase() {
  const q = new URLSearchParams(location.search);
  const name = q.get("showcase") ?? "title", sample = SAMPLES[name as keyof typeof SAMPLES];
  const say = sample.say;
  const { scene, errors } = expandTemplates({ beats: [{ say, template: name, variant: q.get("variant") ?? undefined, data: sample.data }] });
  const drawRef = useRef<((t: number) => void) | null>(null);
  const words = say.split(/\s+/).map((w, i) => ({ word: w, start: i * .3, end: i * .3 + .25 }));
  const tl = scene ? compileOps(Scene.parse(scene), [{ words, duration: words.length * .3 }], 0) : null;
  const t = Number(q.get("t") ?? (tl ? tl.totalSec + 2 : 0));
  const timeRef = useRef(t);
  useEffect(() => { const h = setInterval(() => drawRef.current?.(t), 200); return () => clearInterval(h); }, [t]);
  if (!scene || !tl) return <pre className="p-4 text-fg">{JSON.stringify(errors, null, 2)}</pre>;
  return <div className="grid h-screen place-items-center bg-bg [container-type:size]">
    <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] border border-line"><Stage scene={Scene.parse(scene)} timeline={tl} drawRef={drawRef} timeRef={timeRef} /></div>
  </div>;
}
