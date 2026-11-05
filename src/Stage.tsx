import { useEffect, useRef, useState, type RefObject } from "react";
import { Application } from "pixi.js";
import "katex/dist/katex.min.css";
import type { Timeline } from "@motion/dsl/compile";
import type { Scene } from "@motion/dsl/schema";
import { SceneRenderer } from "@motion/stage/renderer";
import type { Annotation } from "@motion/annotations";
import { applyEventsAt } from "@motion/stage/scene";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// `drawRef.current(t)` is filled once Pixi is ready: update the scene to t, then render (on demand; the ticker never runs).
// `snapshotRef.current(maxW?)` resolves a base64 PNG (no `data:` prefix) of the current frame, or null: full size for the
// tutor, small (`maxW`) for checkpoint thumbnails.
// It captures the Pixi canvas only: KaTeX and gif DOM overlays are not in it.
type Props = {
  scene: Scene; timeline: Timeline; drawRef: RefObject<((t: number) => void) | null>; annotateRef?: RefObject<((a: Annotation[]) => void) | null>;
  timeRef?: RefObject<number>; snapshotRef?: RefObject<((maxW?: number) => Promise<string | null>) | null>;
};
const SNAP_MAX_W = 1280; // plenty for a vision model, and keeps the prompt small

export default function Stage({ scene, timeline, drawRef, annotateRef, timeRef, snapshotRef }: Props) {
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
    // Re-render and copy in the same task: the WebGL drawing buffer is only guaranteed until the frame is presented.
    if (snapshotRef) snapshotRef.current = async (maxW = SNAP_MAX_W) => {
      try {
        draw(last);
        const src = a.canvas, k = Math.min(1, maxW / (src.width || 1));
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(src.width * k)); out.height = Math.max(1, Math.round(src.height * k));
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(src, 0, 0, out.width, out.height);
        const url = out.toDataURL("image/png");
        return url.startsWith("data:image/png;base64,") ? url.slice("data:image/png;base64,".length) : null;
      } catch { return null; }
    };
    draw(last);
    return () => {
      a.renderer.off("resize", onResize);
      drawRef.current = null;
      if (annotateRef) annotateRef.current = null;
      if (snapshotRef) snapshotRef.current = null;
      r.destroy();
    };
  }, [ready, scene, timeline, drawRef, annotateRef, timeRef, snapshotRef]);

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
