import { expect, it, vi } from "vitest";
import { generateCheckpoints, gradeAnswer, type Checkpoint } from "./checkpoints";

const reply = (s: unknown) => ({ complete: vi.fn(async () => typeof s === "string" ? s : JSON.stringify(s)) });

it("keeps valid checkpoints, clamps scene index, drops bad ones", async () => {
  const items = [
    { afterScene: 9, kind: "mcq", prompt: "Root of a max-heap?", choices: ["max", "min"], answer: "max", explanation: "Parents beat children.", source: "textbook", cite: "p. 3" },
    { afterScene: 0, kind: "mcq", prompt: "bad", choices: ["a", "b"], answer: "c", explanation: "x", source: "generated" },
  ];
  const r = await generateCheckpoints({ sectionMarkdown: "md", exercises: [{ id: "e", markdown: "1. What is..." }], scenes: ["a", "b"], provider: reply(items) });
  expect(r).toHaveLength(1);
  expect(r[0].afterScene).toBe(1);
  expect(r[0].id).toBe("cp1");
});

it("never throws on garbage", async () => {
  expect(await generateCheckpoints({ sectionMarkdown: "", exercises: [], scenes: ["a"], provider: reply("nope") })).toEqual([]);
});

it("grades mcq locally and short answers via the model", async () => {
  const mcq = { id: "1", afterScene: 0, kind: "mcq", prompt: "?", choices: ["a", "b"], answer: "a", explanation: "because", source: "generated" } as Checkpoint;
  const p = reply({});
  expect(await gradeAnswer(mcq, "b", p)).toEqual({ correct: false, feedback: "because" });
  expect(p.complete).not.toHaveBeenCalled();
  const short = { ...mcq, kind: "short", choices: undefined } as Checkpoint;
  expect(await gradeAnswer(short, "x", reply({ correct: true, feedback: "Nice." }))).toEqual({ correct: true, feedback: "Nice." });
  expect((await gradeAnswer(short, "x", reply("??"))).correct).toBe(false);
});
