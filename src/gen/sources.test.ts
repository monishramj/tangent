import { expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { generateCheckpoints } from "./checkpoints";
import { checkTemplateScene } from "./scene";
import { checkGrounding, generateScript, parseRepair, type Beat } from "./script";
import { groundingText, mergeByTopic, oneSourceText, tagPassages } from "./sources";

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

it("checks the part-2 join on topic order, and does not prefix a cite that already names a source", async () => {
  const sources = [{ id: "a", markdown: "A heap is a tree." }, { id: "b", markdown: "Parents are larger." }];
  const beats = [
    { say: "A heap is a tree.", visualIntent: "x", topic: "sift", passages: ["a/p1"], cite: "b/p. 2" },
    { say: "Parents are larger.", visualIntent: "x", topic: "heap", passages: ["b/p1"] },
    { say: "A heap is a tree.", visualIntent: "x", topic: "sift", passages: ["a/p1"] },
  ];
  const provider: LLMProvider = { complete: vi.fn(async () => JSON.stringify(beats)) };
  const r = await generateScript({
    sectionMarkdown: "A heap is a tree.", passages: [{ id: "a/p1", markdown: "A heap is a tree." }, { id: "b/p1", markdown: "Parents are larger." }], sources, provider,
    part: { previous: [{ say: "A heap is a tree.", visualIntent: "x" }], outline: "Continue." },
  });
  expect(r.beats?.map(b => b.say)).toEqual(["A heap is a tree.", "A heap is a tree.", "Parents are larger."]);
  expect(r.violations.filter(v => v.rule === "repeated-definition").map(v => v.beat).sort()).toEqual([0, 1]);
  expect(r.beats?.[0].cite).toBe("b/p. 2");
});

it("keeps passages and cite through a repair, and leaves a single-source repair prompt without cite", async () => {
  const sources = [{ id: "a", markdown: "Heaps hold 12 items." }, { id: "b", markdown: "Slides say sift." }];
  const passages = [{ id: "a/p1", markdown: "Heaps hold 12 items." }];
  const bad = [{ say: "It holds 12 items.", visualIntent: "x", topic: "heap", passages: ["a/p1"], cite: "p. 4" }];
  const provider: LLMProvider = { complete: vi.fn(async () => JSON.stringify(bad)) };
  vi.mocked(provider.complete).mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify({ 0: { say: "A heap holds 12 items.", visualIntent: "x" } }));
  const r = await generateScript({ sectionMarkdown: "Heaps hold 12 items.", passages, sources, provider });
  expect(r.beats?.[0]).toMatchObject({ passages: ["a/p1"], cite: "a/p. 4" });
  const kept = parseRepair(JSON.stringify([{ say: "A heap is a tree.", visualIntent: "x" }]), [{ say: "It is a tree.", visualIntent: "x", passages: ["p1"], cite: "p. 9" }], [0]);
  expect(kept?.[0]).toMatchObject({ passages: ["p1"], cite: "p. 9" });
  const single: LLMProvider = { complete: vi.fn(async () => JSON.stringify([{ say: "It is a tree (kind of).", visualIntent: "x", cite: "p. 9" }])) };
  vi.mocked(single.complete).mockResolvedValueOnce(JSON.stringify([{ say: "It is a tree (kind of).", visualIntent: "x", cite: "p. 9" }])).mockResolvedValueOnce(JSON.stringify({ 0: { say: "A heap is a tree.", visualIntent: "x" } }));
  await generateScript({ sectionMarkdown: "A heap is a tree.", provider: single });
  const prev = String(vi.mocked(single.complete).mock.calls[1][0]).split("<previous_answer>")[1];
  expect(prev).not.toContain("p. 9");
});

it("checks an on-screen number against that beat's source passages only", () => {
  const say = "Heaps hold 12.";
  const raw = { objects: [], beats: [{ say, template: "stat", variant: "center", data: { value: 99, label: "Students" } }] };
  const beat = [{ say, visualIntent: "x", passages: ["a/p1"] }] as Beat[];
  const passages = [{ id: "a/p1", markdown: "Heaps hold 12." }, { id: "b/p1", markdown: "The class has 99 students." }];
  const text = oneSourceText(beat[0], passages, new Set(["a", "b"]));
  expect(checkTemplateScene(raw as never, beat, [], [], undefined, [text]).some(e => e.message.includes("99"))).toBe(true);
  expect(checkTemplateScene(raw as never, beat, [], [], undefined, [passages[1].markdown]).some(e => e.message.includes("99"))).toBe(false);
  expect(oneSourceText({ passages: ["a/p1", "b/p1"] }, passages, new Set(["a", "b"]))).toBe("");
});

it("drops a checkpoint whose cite is not the scene's one source", async () => {
  const passages = [{ id: "a/p1", markdown: "Heaps hold 12 items." }, { id: "b/p1", markdown: "The class has 99 students." }];
  const q = { afterScene: 0, kind: "short", prompt: "How many students?", answer: "99", explanation: "The class has 99 students.", source: "generated", cite: "[b/p1]" };
  const provider: LLMProvider = { complete: vi.fn(async (prompt: string) => prompt.startsWith("Check checkpoint") ? JSON.stringify([{ id: "cp1", supported: true }]) : JSON.stringify([q])) };
  expect(await generateCheckpoints({ sectionMarkdown: "merged", exercises: [], scenes: ["Heaps hold 12."], passages, sceneSources: [["a"]], provider })).toEqual([]);
  vi.mocked(provider.complete).mockImplementation(async (prompt: string) => prompt.startsWith("Check checkpoint") ? JSON.stringify([{ id: "cp1", supported: true }]) : JSON.stringify([{ ...q, answer: "12", explanation: "Heaps hold 12 items.", cite: "[a/p1]" }]));
  const kept = await generateCheckpoints({ sectionMarkdown: "merged", exercises: [], scenes: ["Heaps hold 12."], passages, sceneSources: [["a"]], provider });
  expect(kept.map(c => c.cite)).toEqual(["[a/p1]"]);
});
