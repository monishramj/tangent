import { describe, expect, it } from "vitest";
import { layoutScene, MIN_FONT, type LItem, type Measure, type Placed } from "./layout";

const m: Measure = (s, size, bold) => s.length * size * (bold ? 0.6 : 0.5);
const T = (id: string, text: string, extra: Partial<LItem> = {}): LItem => ({ id, type: "text", text, ...extra });
const K = (id: string, text: string): LItem => ({ id, type: "KineticText", text });
type Rect = { l: number; r: number; t: number; b: number };
const rect = (p: Placed, w: number, h: number, bold: boolean): Rect => {
  const lines = p.text!.split("\n"), fs = p.fontSize!;
  const bw = Math.max(...lines.map((l) => m(l, fs, bold))), bh = lines.length * fs * 1.15;
  return { l: p.x * w - bw / 2, r: p.x * w + bw / 2, t: p.y * h - bh / 2, b: p.y * h + bh / 2 };
};
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b - 0.01 && b.t < a.b - 0.01;
const sizes: [number, number][] = [[1280, 720], [400, 800], [1920, 600], [320, 320]];

describe("layoutScene", () => {
  it("keeps explicit x/y", () => {
    const l = layoutScene([T("a", "hi", { x: 0.1, y: 0.2 }), T("b", "yo")], 1280, 720, m);
    expect(l.get("a")).toMatchObject({ x: 0.1, y: 0.2, auto: false });
    expect(l.get("b")!.auto).toBe(true);
  });

  it("title above body, visual in between", () => {
    const l = layoutScene([K("t", "HEAPIFY"), T("b", "body line"), { id: "arr", type: "Array" }], 1280, 720, m);
    const [t, b, a] = ["t", "b", "arr"].map((i) => l.get(i)!);
    expect(t.y).toBeLessThan(0.34);
    expect(a.y).toBeGreaterThan(t.y);
    expect(a.y).toBeLessThan(b.y);
    expect(a.x).toBe(0.5);
  });

  it("packs shapes 3 per row and gives big components their own row", () => {
    const shapes = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, type: "shape" }));
    const l = layoutScene([K("t", "PERF"), ...shapes, { id: "f", type: "flow" }], 1280, 720, m);
    const ys = new Set(shapes.map(s => l.get(s.id)!.y));
    expect(ys.size).toBe(2);
    expect(new Set(shapes.slice(0, 3).map(s => l.get(s.id)!.x)).size).toBe(3);
    expect(l.get("f")!.y).toBeGreaterThan(Math.max(...ys));
    expect(l.get("f")!.x).toBe(0.5);
  });

  for (const [w, h] of sizes) for (const n of [1, 3, 6, 9]) {
    it(`${n} texts fit and never overlap at ${w}x${h}`, () => {
      const items = [K("t", "A rather long kinetic title about heaps and sifting"), ...Array.from({ length: n - 1 }, (_, i) => T(`b${i}`, "The parent swaps with its bigger child, then we check one level down again."))];
      const l = layoutScene(items, w, h, m);
      const rs = items.map((i) => ({ p: l.get(i.id)!, r: rect(l.get(i.id)!, w, h, i.type === "KineticText") }));
      for (const { p, r } of rs) {
        expect(p.fontSize).toBeGreaterThanOrEqual(MIN_FONT);
        if (p.fontSize! > MIN_FONT) { // at the floor we cannot do more
          expect(r.l).toBeGreaterThanOrEqual(-0.5); expect(r.r).toBeLessThanOrEqual(w + 0.5);
          expect(r.t).toBeGreaterThanOrEqual(-0.5); expect(r.b).toBeLessThanOrEqual(h + 0.5);
        }
      }
      if (w * h > 400 * 800 || n <= 3) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i].r, rs[j].r)).toBe(false);
    });
  }

  it("shrinks text when more than 3", () => {
    const body = (n: number) => layoutScene(Array.from({ length: n }, (_, i) => T(`b${i}`, "some body text here")), 1280, 720, m).get("b0")!.fontSize!;
    expect(body(6)).toBeLessThan(body(3));
  });

  it("breaks a word wider than the box", () => {
    const l = layoutScene([T("a", "x".repeat(200))], 300, 600, m).get("a")!;
    expect(l.text!.split("\n").length).toBeGreaterThan(1);
  });
});
