import { describe, expect, it } from "vitest";
import { FALLBACK, ICON_NAMES, iconSvg, resolveIcon } from "./icons";

describe("resolveIcon", () => {
  it("resolves every curated name to a real icon", () => {
    const bad = ICON_NAMES.filter(n => resolveIcon(n) === FALLBACK);
    expect(bad).toEqual([]);
  });
  it("normalizes loose names", () => {
    expect(resolveIcon("Laptop")).toBe(resolveIcon("laptop"));
    expect(resolveIcon("laptop-01")).toBe(resolveIcon("LAPTOP_01"));
  });
  it("never throws and falls back", () => {
    for (const n of ["", "   ", "zzzzqqq", "💥", undefined as unknown as string]) expect(resolveIcon(n)).toBe(FALLBACK);
    expect(FALLBACK.length).toBeGreaterThan(0);
  });
});
describe("iconSvg", () => {
  it("emits kebab-case attributes with the color and no key", () => {
    const svg = iconSvg(resolveIcon("laptop"), "#ffffff");
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).not.toContain("key=");
    expect(svg).not.toContain("currentColor");
  });
});
