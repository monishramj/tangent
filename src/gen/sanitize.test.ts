import { expect, it } from "vitest";
import { stripWatermarks } from "./sanitize";

it("removes zyBooks watermarks and copyright footers but keeps content", () => {
  const md = [
    "A register holds 64 bits.",
    "©zyBooks 01/15/26 14:03 EST 1234567 Jane Q Student PURDUECS250Fall2026",
    "The ALU adds. ©zyBooks 01/15/26 14:03 EST 1234567 Jane Q Student PURDUECS250Fall2026",
    "*01/15/26 14:03 1234567 Jane Q Student PURDUECS250Fall2026*",
    "Copyright 2026 Some Publisher. All rights reserved.",
    "(c) 2026 Somebody",
    "Muxes pick one input.",
  ].join("\n");
  const out = stripWatermarks(md);
  expect(out).toBe("A register holds 64 bits.\nThe ALU adds. \nMuxes pick one input.");
  expect(out).not.toMatch(/Jane|1234567|zyBooks|©/);
});
