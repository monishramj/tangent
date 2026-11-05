import { useEffect, useRef, useState, type RefObject } from "react";
import { Application } from "pixi.js";
import "katex/dist/katex.min.css";
import type { Timeline } from "@/dsl/compile";
import type { Scene } from "@/dsl/schema";
import { SceneRenderer } from "./stage/renderer";
import type { Annotation } from "./tutor/annotations";
import { applyEventsAt } from "./stage/scene";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// `drawRef.current(t)` is filled once Pixi is ready: update the scene to t, then render (on demand; the ticker never runs).
type Props = { scene: Scene; timeline: Timeline; drawRef: RefObject<((t: number) => void) | null>; annotateRef?: RefObject<((a: Annotation[]) => void) | null>; timeRef?: RefObject<number> };
export default function Stage({ scene, timeline, drawRef, annotateRef, timeRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const math = useRef<HTMLDivElement>(null);

  const app = useRef<Application | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const a = app.current;
    if (!ready || !a) return;
    const r = new SceneRenderer(a, scene, math.current!, css);
    let last = timeRef?.current ?? 0;
    const draw = (t: number) => { last = t; r.draw(applyEventsAt(scene, timeline, t)); };
    const onResize = () => draw(last);
    a.renderer.on("resize", onResize);
    drawRef.current = draw;
    if (annotateRef) annotateRef.current = (an) => { r.setAnnotations(an); draw(last); };
    draw(last);
    return () => {
      a.renderer.off("resize", onResize);
      drawRef.current = null;
      if (annotateRef) annotateRef.current = null;
      r.destroy();
    };
  }, [ready, scene, timeline, drawRef, annotateRef, timeRef]);

  // Declared after the renderer effect so unmount destroys the renderer first, then the app.
  // One Pixi app for the Stage's life; scene changes swap only the renderer (no destroy/re-init, no blank frame).
  useEffect(() => {
    const a = new Application();
    let inited = false, dead = false; // StrictMode runs effect, cleanup, effect: drop the first init
    a.init({ background: css("--bg"), resizeTo: host.current!, antialias: true, autoStart: false }).then(() => {
      inited = true;
      if (dead) return a.destroy(true);
      host.current!.insertBefore(a.canvas, math.current);
      app.current = a;
      setReady(true);
    });
    // Pixi's resizeTo only listens to window resize; the box also shrinks when the side panel opens.
    const ro = new ResizeObserver(() => { if (inited && !dead) a.resize(); });
    ro.observe(host.current!);
    return () => { dead = true; ro.disconnect(); app.current = null; if (inited) a.destroy(true); };
  }, []);

  return (
    <div ref={host} role="img" aria-label="Video stage" className="absolute inset-0">
      <div ref={math} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
