import { afterEach, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "./reducedMotion";

afterEach(() => vi.unstubAllGlobals());

it("reads the media query, and is false when matchMedia is missing", () => {
  expect(prefersReducedMotion()).toBe(false);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(prefersReducedMotion()).toBe(true);
});
