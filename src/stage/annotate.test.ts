import { expect, it } from "vitest";
import { annotationShapes } from "./annotate";

const pts = new Map([["h", { x: 400, y: 300, r: 50 }], ["h.slot[1]", { x: 450, y: 320, r: 20 }]]);
const W = 800, H = 600;

it("maps each kind to a shape at the target's laid-out position", () => {
  const s = annotationShapes([
    { kind: "circle", target: "h.slot[1]" },
    { kind: "highlight", target: "h" },
    { kind: "arrow-to", target: "h" },
    { kind: "label", target: "h", text: "swap" },
  ], pts, W, H);
  expect(s.map((x) => x.k)).toEqual(["circle", "rect", "arrow", "text"]);
  expect(s[0]).toMatchObject({ x: 450, y: 320 });
  expect(s[0].k === "circle" && s[0].r).toBeGreaterThan(20);
  const a = s[2];
  if (a.k !== "arrow") throw 0;
  expect(Math.hypot(a.x2 - 400, a.y2 - 300)).toBeLessThanOrEqual(50 * 1.2); // ends at the target, not on its centre
  expect(a.x1).toBeLessThanOrEqual(W);
  expect(a.y1).toBeLessThanOrEqual(H);
  expect(s[3]).toMatchObject({ text: "swap", x: 400 });
});

it("skips targets with no laid-out position", () => {
  expect(annotationShapes([{ kind: "circle", target: "gone" }], pts, W, H)).toEqual([]);
});
