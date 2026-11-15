// @vitest-environment node
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest, readSection } from "./eval-set";

const dir = mkdtempSync(join(tmpdir(), "tangent-eval-"));
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("loads all five public sections with passage anchors and expected facts/numbers", () => {
  const golden = readManifest("scripts/eval-golden.json");
  expect(golden).toHaveLength(5);
  expect(new Set(golden.map(g => g.section)).size).toBe(5);
  for (const entry of golden) {
    expect(entry.ir.startsWith("tests/fixtures/eval/")).toBe(true);
    const section = readSection(entry, dir)!;
    expect(section.markdown!.length).toBeGreaterThan(100);
    expect(section.passages!.map(p => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(section.passages!.map(p => p.markdown).join("\n\n")).toBe(section.markdown);
    expect(entry.expected!.facts.length).toBeGreaterThan(0);
    expect(entry.expected!.numbers.length).toBeGreaterThan(0);
  }
});

it("skips a missing optional manifest, but fails for a missing public manifest", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(readManifest(join(dir, "absent.json"), true)).toEqual([]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("skip local eval manifest"));
  expect(() => readManifest(join(dir, "absent.json"))).toThrow();
});

it("reads local entries in the public schema and skips missing IR or sections", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const g = { name: "local placeholder", ir: join(dir, "ir.json"), section: "nested", pdf: "/TODO.pdf", pages: [1, 2] as [number, number], expected: { facts: ["TODO"], numbers: [] } };
  writeFileSync(join(dir, "local.json"), JSON.stringify([g]));
  expect(readManifest(join(dir, "local.json"), true)).toEqual([g]);
  expect(readSection(g, dir)).toBeUndefined();
  writeFileSync(g.ir, JSON.stringify({ sections: [{ id: "parent", children: [{ id: "nested", markdown: "local text" }] }] }));
  expect(readSection({ ...g, ir: "appdata:ir.json" }, dir)?.markdown).toBe("local text");
  expect(readSection({ ...g, section: "absent" }, dir)).toBeUndefined();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("no section absent"));
});
