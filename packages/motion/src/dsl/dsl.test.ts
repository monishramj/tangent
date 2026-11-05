import { describe, expect, it } from "vitest";
import heapify from "./fixtures/heapify.json";
import { parseTarget } from "./schema";
import { validateScene } from "./validate";

describe("parseTarget", () => {
  it.each([
    ["h", { id: "h" }],
    ["my-arr_2", { id: "my-arr_2" }],
    ["h.slot[0]", { id: "h", slot: 0 }],
    ["h.slot[12]", { id: "h", slot: 12 }],
    ["h.val(9)", { id: "h", val: 9 }],
    ["h.val(-2.5)", { id: "h", val: -2.5 }],
    ["t.val(a)", { id: "t", val: "a" }],
  ])("parses %s", (s, want) => expect(parseTarget(s)).toEqual(want));

  it.each(["", "1h", "h.", "h.slot[]", "h.slot[-1]", "h.slot[1.5]", "h.val()", "h.slot[0].val(1)", "h.foo", "h slot"])(
    "rejects %j",
    (s) => expect(parseTarget(s)).toBeNull(),
  );
});

const clone = () => structuredClone(heapify) as any;

describe("validateScene", () => {
  it("heapify fixture validates clean", () => {
    expect(validateScene(heapify)).toEqual([]);
  });

  const broken: [string, (s: any) => void, string, number | undefined][] = [
    ["missing say", (s) => delete s.beats[0].say, "schema", 0],
    ["unknown object type", (s) => (s.objects[1].type = "Heap"), "schema", undefined],
    ["bad transition", (s) => (s.beats[1].transition = "dissolve"), "schema", 1],
    ["duplicate id", (s) => (s.objects[1].id = "title"), "duplicate-id", undefined],
    ["anchor not in say", (s) => (s.beats[1].actions[0].at = "rotates"), "anchor-not-found", 1],
    ["anchor partial word", (s) => (s.beats[1].actions[0].at = "swap"), "anchor-not-found", 1],
    ["malformed address", (s) => (s.beats[0].actions[2].target = "h.slot[x]"), "bad-target", 0],
    ["slot on primitive", (s) => (s.beats[0].actions[2].target = "title.slot[0]"), "bad-target", 0],
    ["unknown object", (s) => (s.beats[1].actions[0].target = "q"), "unknown-target", 1],
    ["used before create", (s) => (s.beats[0].actions[1].at = "heap"), "not-created", 0],
    [
      "conflict at same anchor",
      (s) => s.beats[1].actions.push({ at: "swaps", do: "highlight", target: "h" }),
      "conflict",
      1,
    ],
    ["op not defined", (s) => (s.beats[1].actions[0].op = "rotateLeft"), "unknown-op", 1],
    ["op on primitive", (s) => (s.beats[1].actions[0].target = "title"), "unknown-op", 1],
    ["slot out of range", (s) => (s.beats[0].actions[2].target = "h.slot[5]"), "slot-out-of-range", 0],
    ["fade to out of [0,1]", (s) => s.beats[1].actions.push({ at: "child", do: "fade", target: "title", to: 2 }), "schema", 1],
    ["anchor occurs twice in say", (s) => ((s.beats[1].say += " Again!"), (s.beats[1].actions[0].at = "again")), "ambiguous-anchor", 1],
  ];

  it.each(broken)("%s", (_name, mutate, code, beat) => {
    const s = clone();
    mutate(s);
    const errs = validateScene(s);
    expect(errs.map((e) => e.code)).toContain(code);
    const e = errs.find((e) => e.code === code)!;
    expect(e.beat).toBe(beat);
    expect(e.path).toBeTruthy();
    expect(e.message).toBeTruthy();
  });

  it("create in an earlier beat counts", () => {
    const s = clone();
    s.beats[1].actions.unshift({ at: "parent", do: "indicate", target: "title" });
    expect(validateScene(s)).toEqual([]);
  });

  it("fade is opacity only: a faded object stays addressable", () => {
    const s = clone();
    s.beats[0].actions.push({ at: "heap", do: "fade", target: "title" }); // default to: 0
    s.beats[1].actions.push({ at: "parent", do: "fade", target: "title", to: 0.5 });
    s.beats[1].actions.push({ at: "child", do: "indicate", target: "title" });
    expect(validateScene(s)).toEqual([]);
  });

  it("non-object input is a schema error, not a throw", () => {
    expect(validateScene(null)[0].code).toBe("schema");
  });
});
