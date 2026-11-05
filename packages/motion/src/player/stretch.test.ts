import { expect, it } from "vitest";
import { stretch } from "./stretch";

const crossings = (y: Float32Array) => { let n = 0; for (let i = 1; i < y.length; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) n++; return n; };

it("changes duration, not pitch", () => {
  const sr = 24000, x = Float32Array.from({ length: sr * 2 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / sr));
  for (const rate of [0.75, 1.5, 2]) {
    const y = stretch(x, rate, sr);
    expect(y.length).toBe(Math.ceil(x.length / rate));
    const hz = crossings(y) / 2 / (y.length / sr);
    expect(Math.abs(hz - 220)).toBeLessThan(3);
  }
  expect(stretch(x, 1, sr)).toEqual(x);
});
