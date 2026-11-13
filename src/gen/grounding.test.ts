import { describe, expect, it } from "vitest";
import { numbersIn, screenText, supportSet, unsupportedNumbers } from "./grounding";

const values = (t: string) => numbersIn(t).map(n => n.value);

describe("numbersIn", () => {
  it("reads digits, separators, decimals, percents and scales", () => {
    expect(values("1,000 items, 3.5 s, 40% and 3 million")).toEqual([1000, 3.5, 40, 3e6]);
    expect(numbersIn("40 percent")[0].percent).toBe(true);
  });
  it("reads spelled-out runs", () => {
    expect(values("fifty people")).toEqual([50]);
    expect(values("two hundred and fifty thousand")).toEqual([250000]);
    expect(values("twenty-five")).toEqual([25]);
    expect(values("a hundred times")).toEqual([100]);
  });
  it("skips digits glued to a name", () => {
    expect(values("LEGv8 and H2O in p12")).toEqual([]);
    expect(numbersIn("LEGv8", false).map(n => n.value)).toEqual([8]);
  });
});

describe("unsupportedNumbers", () => {
  const src = supportSet("About 33.3% of the 1,200 cases were appeals. Half the rest were from 1998. Twelve were dropped.");
  it("accepts numbers the source states, in any form", () => {
    for (const ok of ["1200 cases", "one thousand two hundred cases", "33.3 percent", "33%", "in 1998", "12 were dropped", "0.5 of the rest", "50% of the rest"])
      expect(unsupportedNumbers(ok, src), ok).toEqual([]);
  });
  it("flags invented numbers, percents and scales", () => {
    expect(unsupportedNumbers("Nearly 80% of people fall for it.", src)).toEqual(["80%"]);
    expect(unsupportedNumbers("Since 2004, three million cases.", src)).toEqual(["2004", "three million"]);
    expect(unsupportedNumbers("It costs 4.5 seconds.", src)).toEqual(["4.5"]);
  });
  it("accepts arithmetic the claim shows on its own grounded numbers, not on invented ones", () => {
    const s = supportSet("P(X=6) is 3/29 and P(Y=1) is 5/29.");
    expect(unsupportedNumbers("3 over 29 times 5 over 29 is 15 over 29 squared.", s)).toEqual([]);
    expect(unsupportedNumbers("So 29 plus 29 is 58.", s)).toEqual([]);
    expect(unsupportedNumbers("That gives 47 over 29 squared.", s)).toEqual(["47"]);
    expect(unsupportedNumbers("About 80 and 90 make 170.", s)).toEqual(["80", "90", "170"]);
  });
  it("lets small counts and exponents through", () => {
    expect(unsupportedNumbers("Here are 3 fallacies and two rules. Step 1: n^2.", src)).toEqual([]);
  });
});

describe("screenText", () => {
  it("collects quantities from factual templates only", () => {
    expect(screenText("stat", { value: 40, suffix: "%", label: "of 1200 cases", icon: "chart" })).toEqual(["40", "%", "of 1200 cases", "40%"]);
    expect(screenText("array", { values: [99, 1000] })).toEqual([]);
    expect(screenText("timeline", { events: [{ date: "1998", text: "Ruling", at: "in 2004" }] })).toEqual(["1998", "Ruling"]);
    expect(screenText(undefined, { text: "99" })).toEqual([]);
  });
});
