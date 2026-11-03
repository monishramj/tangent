import { useEffect, useRef } from "react";
import { Application, Graphics, Text } from "pixi.js";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function Stage() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = new Application();
    let ready = false;
    let dead = false; // StrictMode runs effect, cleanup, effect: drop the first init
    const frame = new Graphics();
    const label = new Text({ text: "Tangent", style: { fontFamily: css("--font-serif") || "serif", fontSize: 48, fill: css("--parchment") } });

    const draw = () => {
      const { width: w, height: h } = app.screen;
      frame.clear().roundRect(24, 24, w - 48, h - 48, 24).stroke({ width: 3, color: css("--parchment") });
      label.anchor.set(0.5);
      label.position.set(w / 2, h / 2);
    };

    app
      .init({ background: css("--walnut"), resizeTo: host.current!, antialias: true })
      .then(() => {
        ready = true;
        if (dead) return app.destroy(true);
        host.current!.appendChild(app.canvas);
        app.stage.addChild(frame, label);
        app.renderer.on("resize", draw);
        draw();
      });

    return () => {
      dead = true;
      if (ready) app.destroy(true);
    };
  }, []);

  return <div ref={host} role="img" aria-label="Video stage" className="vignette min-h-0 flex-1 overflow-hidden rounded-3xl border border-brass/40" />;
}
