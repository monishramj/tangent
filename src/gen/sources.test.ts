import { expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { checkGrounding, generateScript } from "./script";
import { groundingText, mergeByTopic, tagPassages } from "./sources";

const box = { page: 1, bbox: [0, 0, 1, 1] as [number, number, number, number] };

it("tags passage ids with the source id only when several sources are combined", () => {
  const one = tagPassages([{ id: "a", passages: [{ id: "p1", markdown: "Heaps.", boxes: [box] }] }]);
  expect(one.map(p => p.id)).toEqual(["p1"]);
  const two = tagPassages([
    { id: "a", passages: [{ id: "p1", markdown: "Heaps hold 12.", boxes: [box] }] },
    { id: "b", passages: [{ id: "p1", markdown: "Sift down.", boxes: [] }] },
  ]);
  expect(two.map(p => p.id)).toEqual(["a/p1", "b/p1"]);
});

it("checks a beat against the source its cite names, not the other source", () => {
  const sources = [{ id: "a", markdown: "A heap holds 12 items." }, { id: "b", markdown: "The slide lists 99 students." }];
  const beat = (passages: string[]) => ({ say: "The class has 99 students.", visualIntent: "x", passages });
  expect(checkGrounding([beat(["a/p1"])], "unused", sources).map(v => v.rule)).toEqual(["unsupported-number"]);
  expect(checkGrounding([beat(["b/p1"])], "unused", sources)).toEqual([]);
  expect(groundingText(beat(["a/p1"]), "fallback", sources)).toBe("A heap holds 12 items.");
  expect(checkGrounding([beat([])], "The class has 99 students.")).toEqual([]);
});

it("groups beats by topic and otherwise keeps source order", () => {
  const beats = [
    { say: "Sift once.", visualIntent: "x", topic: "sift" },
    { say: "A heap holds 12.", visualIntent: "x", topic: "heap" },
    { say: "Sift again.", visualIntent: "x", topic: "sift" },
  ];
  expect(mergeByTopic(beats).beats.map(b => b.say)).toEqual(["Sift once.", "Sift again.", "A heap holds 12."]);
  const plain = beats.map(({ topic: _t, ...b }) => b);
  expect(mergeByTopic(plain)).toEqual({ beats: plain, note: "kept source order; outline has no topic groups" });
});

it("asks the script to merge sources by topic and prefixes cite with the source id", async () => {
  const passages = [{ id: "a/p1", markdown: "Heaps hold 12 items." }, { id: "b/p1", markdown: "Slides say sift down." }];
  const sources = [{ id: "a", markdown: "Heaps hold 12 items." }, { id: "b", markdown: "Slides say sift down." }];
  const raw = [
    { say: "Slides say sift down.", visualIntent: "down", topic: "sift", passages: ["b/p1"], cite: "p. 2" },
    { say: "Heaps hold 12 items.", visualIntent: "heap", topic: "heap", passages: ["a/p1"] },
    { say: "Sift the root down.", visualIntent: "down", topic: "sift", passages: ["b/p1"] },
  ];
  const provider: LLMProvider = { complete: vi.fn(async () => JSON.stringify(raw)) };
  const r = await generateScript({ sectionMarkdown: sources.map(s => s.markdown).join("\n"), passages, sources, provider });
  const prompt = vi.mocked(provider.complete).mock.calls[0][0];
  expect(prompt).toContain("several sources");
  expect(prompt).toContain("Merge by topic");
  expect(prompt).toContain("[a/p1]");
  expect(r.mergeNote).toBeUndefined();
  expect(r.beats?.map(b => b.say)).toEqual(["Slides say sift down.", "Sift the root down.", "Heaps hold 12 items."]);
  expect(r.beats?.[0].cite).toBe("b/p. 2");
  expect(r.beats?.[2].passages).toEqual(["a/p1"]);
});
