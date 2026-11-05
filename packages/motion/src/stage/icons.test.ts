import { describe, expect, it } from "vitest";
import * as all from "@hugeicons/core-free-icons";
import { FALLBACK, ICON_GUIDE, ICON_NAMES, SYNONYMS, iconSvg, resolveIcon } from "./icons";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const exact = new Set(Object.keys(all).filter(k => k.endsWith("Icon")).map(k => norm(k.slice(0, -4))));
const isExact = (n: string) => exact.has(norm(n)) || exact.has(norm(n) + "01");

describe("resolveIcon", () => {
  it("curates ~400 names, each an exact Hugeicons match (directly or through a synonym)", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(350);
    expect(ICON_NAMES.filter(n => !isExact(SYNONYMS[n] ?? n))).toEqual([]);
  });
  it("maps synonyms to exact icons", () => {
    expect(Object.entries(SYNONYMS).filter(([, v]) => !isExact(v))).toEqual([]);
    expect(resolveIcon("RAM")).toBe(resolveIcon("ram-memory"));
    expect(resolveIcon("server rack")).toBe(resolveIcon("server-stack"));
    expect(resolveIcon("db")).toBe(resolveIcon("database"));
    expect(resolveIcon("idea")).toBe(resolveIcon("lightbulb"));
  });
  it("normalizes loose names", () => {
    expect(resolveIcon("Laptop")).toBe(resolveIcon("laptop"));
    expect(resolveIcon("laptop-01")).toBe(resolveIcon("LAPTOP_01"));
  });
  it("never throws and falls back", () => {
    for (const n of ["", "   ", "zzzzqqq", "💥", undefined as unknown as string]) expect(resolveIcon(n)).toBe(FALLBACK);
    expect(FALLBACK.length).toBeGreaterThan(0);
  });
  it("has a compact guide of ~60 names", () => {
    const names = ICON_GUIDE.split(/[;:,]\s*/).filter(s => !/^[a-z]+$/.test(s) || ICON_NAMES.includes(s));
    expect(names.length).toBeGreaterThan(50);
    expect(ICON_GUIDE.length).toBeLessThan(900);
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
