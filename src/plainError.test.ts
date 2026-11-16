import { expect, it } from "vitest";
import { plainError } from "./plainError";

it("passes app-authored plain text through", () => { expect(plainError(new Error("The library has not loaded. Try again."))).toMatch(/^The library/); });

it("maps known technical errors and hides the raw text", () => {
  expect(plainError(new Error("Unable to play scene scene-1: Failed to fetch"))).toBe("Couldn't load this scene's audio. Try again.");
  expect(plainError("TypeError: Failed to fetch")).toMatch(/network/);
  expect(plainError("ENOENT: no such file")).toMatch(/Couldn't find/);
  expect(plainError("EACCES: permission denied")).toMatch(/permission/);
  expect(plainError("Error: kaboom at x.ts:1")).toBe("Something went wrong. Try again.");
});
