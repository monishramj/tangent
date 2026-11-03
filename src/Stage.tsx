import { useEffect, useRef, type RefObject } from "react";
import { Application } from "pixi.js";
import "katex/dist/katex.min.css";
import type { Timeline } from "@/dsl/compile";
import type { Scene } from "@/dsl/schema";
import { SceneRenderer } from "./stage/renderer";
import type { Annotation } from "./tutor/annotations";
import { applyEventsAt } from "./stage/scene";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// `drawRef.current(t)` is filled once Pixi is ready: update the scene to t, then render (on demand; the ticker never runs).
type Props = { scene: Scene; timeline: Timeline; drawRef: RefObject<((t: number) => void) | null>; annotateRef?: RefObject<((a: Annotation[]) => void) | null> };
export default function Stage({ scene, timeline, drawRef, annotateRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const math = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = new Application();
    let ready = false;
    let dead = false; // StrictMode runs effect, cleanup, effect: drop the first init
    let r: SceneRenderer | null = null;
    let last = 0;
    const draw = (t: number) => {
      last = t;
      r?.draw(applyEventsAt(scene, timeline, t));
    };

    app
      .init({ background: css("--bg"), resizeTo: host.current!, antialias: true, autoStart: false })
      .then(() => {
        ready = true;
        if (dead) return app.destroy(true);
        host.current!.insertBefore(app.canvas, math.current);
        r = new SceneRenderer(app, scene, math.current!, css);
        app.renderer.on("resize", () => draw(last));
        drawRef.current = draw;
        if (annotateRef) annotateRef.current = (a) => { r?.setAnnotations(a); draw(last); };
        draw(last);
      });

    return () => {
      dead = true;
      drawRef.current = null;
      if (annotateRef) annotateRef.current = null;
      r?.destroy();
      if (ready) app.destroy(true);
    };
  }, [scene, timeline, drawRef, annotateRef]);

  return (
    <div ref={host} role="img" aria-label="Video stage" className="absolute inset-0">
      <div ref={math} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
