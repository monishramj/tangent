import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function Stage() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = new Application();
    let ready = false;
    let dead = false; // StrictMode runs effect, cleanup, effect: drop the first init
    const cross = new Graphics();

    // placeholder: a faint crosshair proves WebGL is drawing
    const draw = () => {
      const { width: w, height: h } = app.screen;
      cross.clear().moveTo(w / 2 - 12, h / 2).lineTo(w / 2 + 12, h / 2).moveTo(w / 2, h / 2 - 12).lineTo(w / 2, h / 2 + 12)
        .stroke({ width: 1, color: css("--fg"), alpha: 0.15 });
      app.render(); // on demand: the ticker never runs, so a static stage costs nothing
    };

    app
      .init({ background: css("--bg"), resizeTo: host.current!, antialias: true, autoStart: false })
      .then(() => {
        ready = true;
        if (dead) return app.destroy(true);
        host.current!.appendChild(app.canvas);
        app.stage.addChild(cross);
        app.renderer.on("resize", draw);
        draw();
      });

    return () => {
      dead = true;
      if (ready) app.destroy(true);
    };
  }, []);

  return <div ref={host} role="img" aria-label="Video stage" className="absolute inset-0" />;
}
