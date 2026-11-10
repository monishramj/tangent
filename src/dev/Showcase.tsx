// Dev-only: ?showcase=<template>[&variant=..][&t=..][&beat=<json>][&data=<json>][&prev=<template>&tr=whip|push|cut] renders one templated beat with
// fake word timings (no LLM/TTS). `prev` puts another template's beat first so the clear + transition are visible.
// ?reel=1[&only=a,b] plays every template x variant (+ the Tangenter) back to back in real time for review:
// label shows which beat; space pauses, ←/→ step beats, r restarts; stops at the end.
// window.__draw(t) / window.__total let a frame-capture script scrub the beat without reloading.
import { useEffect, useRef, useState } from "react";
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
  const reel: (Record<string, unknown> & { say: string; template: string; variant: string })[] =
    names.flatMap(n => VARIANTS[n].map(v => ({ say: SAMPLES[n].say, template: n, variant: v, data: SAMPLES[n].data })));
  if (!only || only.includes("tangenter")) // the recurring presenter is a beat extra, shown over a stat beat
    reel.push({ say: SAMPLES.stat.say, template: "stat", variant: "center", data: SAMPLES.stat.data, tangenter: { pose: "point", says: "Watch this" } });
  const { scene, errors } = expandTemplates({ beats: reel });
  const audio = reel.map((b) => {
    const words = b.say.split(/\s+/).map((w, i) => ({ word: w, start: i * .3, end: i * .3 + .25 }));
    return { words, duration: words.length * .3 };
  });
  const tl = scene ? compileOps(Scene.parse(scene), audio, 0) : null;
  const drawRef = useRef<((t: number) => void) | null>(null), timeRef = useRef(0), labelRef = useRef<HTMLDivElement>(null);
  const clock = useRef({ playing: true, base: 0, at: performance.now() }); // t = base + (now - at) while playing
  const [playing, setPlaying] = useState(true);
  const starts = tl ? reel.map((_, i) => tl.events.find(e => e.verb === "say" && e.beat === i)?.start ?? 0) : [];
  const now = () => { const c = clock.current; return c.playing ? c.base + (performance.now() - c.at) / 1000 : c.base; };
  const seek = (t: number) => { clock.current = { ...clock.current, base: Math.max(0, Math.min(t, tl?.totalSec ?? 0)), at: performance.now() }; };
  const toggle = () => { const t = now(); clock.current = { playing: !clock.current.playing, base: t, at: performance.now() }; setPlaying(clock.current.playing); };
  const beatAt = (t: number) => Math.max(0, starts.filter(s => s <= t + 1e-6).length - 1);
  const jump = (d: number) => seek(starts[Math.max(0, Math.min(starts.length - 1, beatAt(now()) + d))] ?? 0);
  useEffect(() => {
    if (!tl) return;
    let raf = 0;
    const tick = () => {
      let t = now();
      if (t >= tl.totalSec) { t = tl.totalSec; if (clock.current.playing) { clock.current = { playing: false, base: t, at: performance.now() }; setPlaying(false); } }
      timeRef.current = t; drawRef.current?.(t);
      const i = beatAt(t), b = reel[i];
      if (labelRef.current) labelRef.current.textContent = `${i + 1} / ${reel.length}   ${b.template} / ${b.variant}${b.tangenter ? " + tangenter" : ""}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // frame capture: __reel.at(i, dt) pauses at beat i + dt seconds
    (window as unknown as { __reel?: unknown }).__reel = { starts, total: tl.totalSec, names: reel.map(b => `${b.template}-${b.variant}`),
      at: (i: number, dt: number) => { clock.current = { playing: false, base: Math.min(tl.totalSec, starts[i] + dt), at: performance.now() }; setPlaying(false); } };
    const key = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") jump(1);
      else if (e.key === "ArrowLeft") jump(beatAt(now()) > 0 && now() - starts[beatAt(now())] < .6 ? -1 : 0); // ← restarts the beat, twice goes back
      else if (e.key.toLowerCase() === "r") seek(0);
    };
    addEventListener("keydown", key);
    return () => { cancelAnimationFrame(raf); removeEventListener("keydown", key); };
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scene || !tl) return <pre className="p-4 text-fg">{JSON.stringify(errors, null, 2)}</pre>;
  const btn = "rounded-md border border-fg/20 px-3 py-1 font-mono text-xs text-fg/80 hover:bg-fg/10";
  return <div className="grid h-screen grid-rows-[auto_1fr] bg-bg">
    <div className="flex items-center gap-2 px-3 py-2">
      <div ref={labelRef} className="mr-auto font-mono text-sm text-fg" />
      <button className={btn} onClick={() => jump(-1)}>◀ prev</button>
      <button className={btn} onClick={toggle}>{playing ? "pause" : "play"}</button>
      <button className={btn} onClick={() => jump(1)}>next ▶</button>
      <span className="font-mono text-xs text-fg/40">space · ← → · r</span>
    </div>
    <div className="grid place-items-center [container-type:size]">
      <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))]"><Stage scene={Scene.parse(scene)} timeline={tl} drawRef={drawRef} timeRef={timeRef} /></div>
    </div>
  </div>;
}
