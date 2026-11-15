import { expect, it } from "vitest";
import { paragraphs, retrievePassages, terms } from "./retrieve";

const section = [
  "## Heaps",
  "A heap is a complete binary tree stored in an array. In a max-heap every parent is at least as big as its children.",
  "## Sift down",
  "Sift down repairs one broken spot. The parent swaps with its bigger child, then we check again one level down.",
  "Hash tables map keys to buckets with a hash function. Collisions are handled with chaining or probing.",
  "Insertion appends at the end and sifts up, swapping with the parent while the parent is smaller.",
].join("\n\n");

it("terms drops stopwords and folds simple endings", () => {
  expect(terms("Why do the parents swap with children?")).toEqual(["parent", "swap", "children"]);
  expect(terms("trees tree swapping swapped")).toEqual(["tree", "tree", "swapp", "swapp"]);
});

it("glues short headings onto the next paragraph", () => {
  const p = paragraphs(section);
  expect(p).toHaveLength(4);
  expect(p[0].startsWith("## Heaps\nA heap")).toBe(true);
});

it("ranks by keyword overlap, keeps section order, respects k and the char cap", () => {
  const r = retrievePassages(section, "what happens with collisions in a hash table?", { k: 1 });
  expect(r).toHaveLength(1);
  expect(r[0]).toContain("Collisions");
  const two = retrievePassages(section, "parent swaps with bigger child", { k: 2 });
  expect(two).toHaveLength(2);
  const all = paragraphs(section);
  expect(all.indexOf(two[0])).toBeLessThan(all.indexOf(two[1]));
  expect(all.indexOf(two[0])).toBeGreaterThanOrEqual(0);
  expect(two.join(" ")).toContain("Sift down");
  const capped = retrievePassages(section, "parent swap child heap", { k: 4, maxChars: 150 });
  expect(capped.join("").length).toBeLessThanOrEqual(150);
});

it("falls back to the opening passages when nothing overlaps, and handles empty input", () => {
  expect(retrievePassages(section, "zebra", { k: 1 })[0]).toContain("A heap is");
  expect(retrievePassages("", "anything")).toEqual([]);
});


it("supplies the current passage first when a paraphrase has no keyword overlap", () => {
  const current = "Evaporation converts liquid into vapor.";
  const text = "Granite contains quartz.\n\n" + current;
  expect(retrievePassages(text, "Why does a puddle disappear?", { k: 1 })).toEqual(["Granite contains quartz."]);
  expect(retrievePassages(text, "Why does a puddle disappear?", { k: 1, preferred: [current] })).toEqual([current]);
});

it("deduplicates preferred passages and fills the remaining count and character budget by keywords", () => {
  const preferred = "Evaporation converts liquid into vapor.";
  const other = "Granite contains quartz.";
  expect(retrievePassages(other + "\n\n" + preferred, "quartz", { k: 2, preferred: [preferred, preferred] })).toEqual([preferred, other]);
  const capped = retrievePassages(other, "quartz", { preferred: [preferred], maxChars: preferred.length + 8 });
  expect(capped[0]).toBe(preferred);
  expect(capped.join("").length).toBe(preferred.length + 8);
  expect(capped[1]).toBe("Granite…");
});
