import { describe, expect, it } from "vitest";
import { counterValue, dashPolylines, formatCount, partialPath, pathLength, routePoints, shapeOutline, trimPath, wordPlacements } from "./geometry";

describe("routePoints", () => {
  it("straight", () => expect(routePoints([0, 0], [10, 5])).toEqual([[0, 0], [10, 5]]));
  it("elbow goes H-V-H through mid x when wide", () => expect(routePoints([0, 0], [100, 40], "elbow")).toEqual([[0, 0], [50, 0], [50, 40], [100, 40]]));
  it("elbow goes V-H-V when tall", () => expect(routePoints([0, 0], [20, 100], "elbow")).toEqual([[0, 0], [0, 50], [20, 50], [20, 100]]));
  it("curve bows ~20% of the length and keeps endpoints", () => {
    const p = routePoints([0, 0], [100, 0], "curve");
    expect(p[0]).toEqual([0, 0]); expect(p[p.length - 1][0]).toBeCloseTo(100); expect(p[p.length - 1][1]).toBeCloseTo(0);
    expect(Math.abs(p[12][1])).toBeCloseTo(20, 0);
  });
});
describe("trim/partial/dash", () => {
  it("trims by arc length across corners", () => {
    const p = trimPath([[0, 0], [10, 0], [10, 10]], 4, 4);
    expect(p[0]).toEqual([4, 0]); expect(p[1]).toEqual([10, 0]); expect(p[2][0]).toBeCloseTo(10); expect(p[2][1]).toBeCloseTo(6);
    expect(pathLength(p)).toBeCloseTo(12);
  });
  it("returns [] when trimmed away", () => expect(trimPath([[0, 0], [10, 0]], 6, 6)).toEqual([]));
  it("partialPath follows the path", () => {
    const p = partialPath([[0, 0], [10, 0], [10, 10]], .75);
    expect(pathLength(p)).toBeCloseTo(15); expect(p[p.length - 1]).toEqual([10, 5]);
  });
  it("dashes", () => {
    const d = dashPolylines([[0, 0], [100, 0]], 10, 10);
    expect(d).toHaveLength(5); expect(d[0]).toEqual([[0, 0], [10, 0]]);
  });
});
describe("shapeOutline", () => {
  it("fits its box for every kind", () => {
    for (const k of ["rect", "circle", "polygon", "diamond", "pill", "cylinder", "trapezoid", "hexagon", "parallelogram", "alu"]) {
      const { pts, fill } = shapeOutline(k, 200, 100);
      expect(pts.length).toBeGreaterThan(2); expect(fill.length).toBeGreaterThan(2);
      for (const [x, y] of pts) { expect(Math.abs(x)).toBeLessThanOrEqual(100.001); expect(Math.abs(y)).toBeLessThanOrEqual(50.001); }
    }
  });
  it("alu has a V notch on the left", () => expect(shapeOutline("alu", 100, 100).fill).toContainEqual([-25, 0]));
});
describe("counter", () => {
  it("formats", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(3.14159, 2, "$", "M")).toBe("$3.14M");
    expect(formatCount(0.5, 0)).toBe("1");
  });
  it("interpolates and clamps", () => {
    expect(counterValue(10, 20, 0)).toBe(10); expect(counterValue(10, 20, .5)).toBe(15); expect(counterValue(10, 20, 2)).toBe(20);
  });
});
describe("wordPlacements", () => {
  it("centres each line and stacks lines", () => {
    const w = wordPlacements("aa bb\ncc", 10, s => s.length * 5);
    expect(w).toHaveLength(3);
    expect(w[0].x + w[1].x).toBeCloseTo(0, 5); // first line symmetric
    expect(w[2].x).toBeCloseTo(0); expect(w[2].y).toBeGreaterThan(w[0].y);
  });
});
