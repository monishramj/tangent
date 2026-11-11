import { expect, it } from "vitest";
import { pinchGeometry } from "./pinch";

it("keeps transformed content at the same viewport pixel after size and scroll commit", () => {
  for (const scale of [0.5, 1, 1.37, 4]) {
    const point = { x: 143, y: 215 }, scroll = { x: 87, y: 1260 }, inset = { x: 12, y: 72 };
    const result = pinchGeometry(point, scroll, inset, scale);
    expect(result.origin).toEqual({ x: 218, y: 1403 });
    for (const axis of ["x", "y"] as const) {
      for (const coordinate of [0, 200, 1700]) {
        const preview = inset[axis] + result.origin[axis] + (coordinate - result.origin[axis]) * scale - scroll[axis];
        const committed = inset[axis] + coordinate * scale - result.scroll[axis];
        expect(committed).toBeCloseTo(preview, 8);
      }
    }
  }
});

it("compensates the preview when a zoom-out reaches scroll boundaries", () => {
  const point = { x: 160, y: 200 }, scroll = { x: 0, y: 900 }, inset = { x: 12, y: 0 };
  const result = pinchGeometry(point, scroll, inset, 0.5, { x: 0, y: 300 });
  expect(result.scroll).toEqual({ x: 0, y: 300 });
  for (const axis of ["x", "y"] as const) {
    const preview = inset[axis] + result.origin[axis] + (700 - result.origin[axis]) * 0.5 - scroll[axis] + result.translate[axis];
    expect(preview).toBeCloseTo(inset[axis] + 700 * 0.5 - result.scroll[axis]);
  }
});
