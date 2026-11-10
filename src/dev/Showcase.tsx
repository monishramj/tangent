// Dev-only: ?showcase=<template>[&variant=..][&t=..][&beat=<json>][&data=<json>][&prev=<template>&tr=whip|push|cut] renders one templated beat with
// fake word timings (no LLM/TTS). `prev` puts another template's beat first so the clear + transition are visible.
// ?reel=1[&only=a,b] plays every template x variant back to back in real time (label shows which), looping.
// window.__draw(t) / window.__total let a frame-capture script scrub the beat without reloading.
import { useEffect, useRef } from "react";
import Stage from "@/Stage";
import { compileOps } from "@motion/dsl/ops";
import { expandTemplates, VARIANTS, type TemplateName } from "@motion/dsl/templates";
import { Scene } from "@motion/dsl/schema";
import { SAMPLES } from "./samples";

export default function Showcase() {
  const q = new URLSearchParams(location.search);
  if (q.get("reel")) return <Reel only={q.get("only")?.split(",")} />;
  const name = q.get("showcase") ?? "title", sample = SAMPLES[name as keyof typeof SAMPLES];
  const prev = q.get("prev"), prevSample = prev ? SAMPLES[prev as keyof typeof SAMPLES] : undefined;
  const say = sample.say;
  // &beat=<json> merges extra beat fields (emphasis, energy, texture, accent, objects/actions ...); &data=<json> replaces the sample data.
  const extra: Record<string, unknown> = JSON.parse(q.get("beat") ?? "{}"), data = q.get("data") ? JSON.parse(q.get("data")!) : sample.data;
  const beat: Record<string, unknown> & { say: string } = { say, template: name, variant: q.get("variant") ?? undefined, data, transition: q.get("tr") ?? undefined, ...extra };
  if (extra.template === null) delete beat.template; // raw objects only
  const beats: { say: string }[] = prevSample ? [{ say: prevSample.say, template: prev, variant: q.get("pv") ?? undefined, data: prevSample.data }, beat] : [beat];
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

function Reel({ only }: { only?: string[] }) {
  const names = (Object.keys(VARIANTS) as TemplateName[]).filter(n => !only || only.includes(n));
  const reel = names.flatMap(n => VARIANTS[n].map(v => ({ say: SAMPLES[n].say, template: n, variant: v, data: SAMPLES[n].data })));
  const { scene, errors } = expandTemplates({ beats: reel });
  const audio = reel.map((b) => {
    const words = b.say.split(/\s+/).map((w, i) => ({ word: w, start: i * .3, end: i * .3 + .25 }));
    return { words, duration: words.length * .3 };
  });
  const tl = scene ? compileOps(Scene.parse(scene), audio, 0) : null;
  const drawRef = useRef<((t: number) => void) | null>(null), timeRef = useRef(0), labelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tl) return;
    const starts = reel.map((_, i) => tl.events.find(e => e.verb === "say" && e.beat === i)?.start ?? 0), t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const t = ((performance.now() - t0) / 1000) % (tl.totalSec + 1);
      timeRef.current = t; drawRef.current?.(t);
      const i = starts.filter(s => s <= t).length - 1, b = reel[Math.max(0, i)];
      if (labelRef.current) labelRef.current.textContent = `${i + 1}/${reel.length}  ${b.template} / ${b.variant}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scene || !tl) return <pre className="p-4 text-fg">{JSON.stringify(errors, null, 2)}</pre>;
  return <div className="grid h-screen place-items-center bg-bg [container-type:size]">
    <div ref={labelRef} className="fixed left-3 top-2 z-10 font-mono text-xs text-fg/60" />
    <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))]"><Stage scene={Scene.parse(scene)} timeline={tl} drawRef={drawRef} timeRef={timeRef} /></div>
  </div>;
}
