import { expect, it } from "vitest";
import { splitBeatAudio } from "./splitAudio";

const w = (word: string, start: number, end: number) => ({ word, start, end });

it("splits words per beat, keeps sentence boundaries, and sums durations to the wav length", () => {
  const clips = splitBeatAudio(["One two.", "Three 4 five."], {
    sec: 5, words: [w("One", 0.2, 0.6), w("two.", 0.7, 1), w("Three", 2, 2.4), w("five.", 3, 3.5)],
  });
  expect(clips.map(c => c.words.map(x => x.word))).toEqual([["One", "two."], ["Three", "five."]]);
  expect(clips[0].duration).toBeCloseTo(1.5);
  expect(clips[1].words[0].start).toBeCloseTo(0.5);
  expect(clips[0].duration + clips[1].duration).toBeCloseTo(5);
});

it("rejects an alignment that does not match the beats", () => {
  expect(() => splitBeatAudio(["One two.", "Three."], { sec: 3, words: [w("One", 0, 1), w("two.", 1, 2)] })).toThrow(/does not match/);
});
