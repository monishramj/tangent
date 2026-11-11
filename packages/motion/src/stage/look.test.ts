import { describe, expect, it } from "vitest";
import { circleLoop, litRuns, rectLoop } from "./look";

describe("look", () => {
  it("body outlines are closed and start top-centre (symmetric trace)", () => {
    for (const loop of [rectLoop(100, 60, 8), circleLoop(30)]) {
      expect(loop[0][0]).toBeCloseTo(0); expect(loop[0][1]).toBeLessThan(0);
      const [a, b] = [loop[loop.length - 1], loop[0]]; expect(a[0]).toBeCloseTo(b[0]); expect(a[1]).toBeCloseTo(b[1]);
    }
  });
  it("the lit side is the top-left", () => {
    const runs = litRuns(circleLoop(30), 30, 30).flat();
    expect(runs.length).toBeGreaterThan(0);
    for (const [x, y] of runs) expect(x * .6 + y * .8).toBeLessThan(5); // light from (.6,.8) toward the scene: lit points face up-left
  });
});
