import { describe, expect, it } from "vitest";
import { mathToSpeech } from "./mathToSpeech";

const cases: [string, string][] = [
  // complexity
  ["O(n \\log n)", "big O of n log n"],
  ["O(n^2)", "big O of n squared"],
  ["$O(1)$", "big O of 1"],
  ["\\Theta(n)", "big theta of n"],
  ["\\mathcal{O}(n \\log n)", "big O of n log n"],
  ["O(2^n)", "big O of 2 to the n"],
  ["\\log_2 n", "log base 2 n"],
  ["\\log_2(n)", "log base 2 of n"],
  ["\\log n", "log n"],
  ["\\ln x", "natural log x"],
  // powers and subscripts
  ["x^2", "x squared"],
  ["x^3", "x cubed"],
  ["x^{n+1}", "x to the power n plus 1"],
  ["e^{-x^2}", "e to the power negative x squared"],
  ["A^{-1}", "A inverse"],
  ["A^T", "A transpose"],
  ["f'", "f prime"],
  ["x_i", "x sub i"],
  ["x_{i+1}", "x sub i plus 1"],
  ["a_1 + a_2", "a sub 1 plus a sub 2"],
  ["x_i^2", "x sub i squared"],
  // fractions and roots
  ["\\frac{1}{2}", "one half"],
  ["\\frac{1}{n}", "1 over n"],
  ["\\frac{a}{b}", "a over b"],
  ["\\frac{a+b}{c}", "a plus b all over c"],
  ["\\sqrt{x}", "square root of x"],
  ["\\sqrt[3]{x}", "cube root of x"],
  ["\\sqrt{n}", "square root of n"],
  // sums etc
  ["\\sum_{i=1}^{n} i", "the sum from i equals 1 to n of i"],
  ["\\sum_{i=1}^n x_i", "the sum from i equals 1 to n of x sub i"],
  ["\\sum x", "the sum of x"],
  ["\\prod_{i=1}^{n} a_i", "the product from i equals 1 to n of a sub i"],
  ["\\int_0^1 f(x) dx", "the integral from 0 to 1 of f of x dx"],
  ["\\lim_{x \\to 0} f(x)", "the limit as x goes to 0 of f of x"],
  ["\\binom{n}{k}", "n choose k"],
  ["n!", "n factorial"],
  ["(n-1)!", "the quantity n minus 1 factorial"],
  ["5!", "5 factorial"],
  // stats
  ["P(X=x)", "P of X equals x"],
  ["P(A|B)", "P of A given B"],
  ["E[X]", "expected value of X"],
  ["\\mathbb{E}[X]", "expected value of X"],
  ["\\mathbb{E}[X^2]", "expected value of X squared"],
  ["\\text{Var}(X)", "variance of X"],
  ["X \\sim N(0, 1)", "X is distributed as N of 0, 1"],
  ["\\bar{x}", "x bar"],
  ["\\hat{\\beta}", "beta hat"],
  ["\\mu \\pm 2\\sigma", "mu plus or minus 2 sigma"],
  ["\\alpha = 0.05", "alpha equals 0.05"],
  ["\\chi^2", "chi squared"],
  // relations / logic / sets
  ["x \\le y", "x is less than or equal to y"],
  ["x \\geq 0", "x is greater than or equal to 0"],
  ["a \\neq b", "a does not equal b"],
  ["x \\in S", "x in S"],
  ["A \\cup B", "A union B"],
  ["A \\cap B", "A intersection B"],
  ["\\emptyset", "the empty set"],
  ["\\forall x \\exists y", "for all x there exists y"],
  ["p \\Rightarrow q", "p implies q"],
  ["a \\cdot b", "a times b"],
  ["a \\times b", "a times b"],
  ["x \\to \\infty", "x goes to infinity"],
  ["\\lfloor n/2 \\rfloor", "floor of n over 2"],
  ["\\lceil x \\rceil", "ceiling of x"],
  ["a \\bmod n", "a mod n"],
  // signs and misc
  ["-1", "negative 1"],
  ["x - 1", "x minus 1"],
  ["x-1", "x minus 1"],
  ["2(x+1)", "2 the quantity x plus 1"],
  ["(a+b)^2", "the quantity a plus b squared"],
  ["\\left( \\frac{a}{b} \\right)^2", "the quantity a over b squared"],
  ["1,000 items", "1,000 items"],
  ["a \\le b \\le c", "a is less than or equal to b is less than or equal to c"],
  ["50\\%", "50 percent"],
  // unicode
  ["α ≤ β", "alpha is less than or equal to beta"],
  ["n² + π", "n squared plus pi"],
  ["x ≠ ∞", "x does not equal infinity"],
  // plain prose passes through
  ["Heapify fixes one broken spot.", "Heapify fixes one broken spot."],
  ["A well-known result", "A well-known result"],
  ["Wow! Great.", "Wow! Great."],
  ["The cost is $O(n)$ per step.", "The cost is big O of n per step."],
  // unknown / malformed never throw
  ["\\foo{x}", "foo x"],
  ["\\weirdmacro + 1", "weirdmacro plus 1"],
  ["\\frac{1", "1"],
  ["x^{", "x"],
  ["}{", ""],
  ["", ""],
];

describe("mathToSpeech", () => {
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(mathToSpeech(input)).toBe(expected);
  });

  it("never throws on junk", () => {
    for (const junk of ["\\", "^", "_", "\\frac", "\\sqrt[", "((((", "\\sum_^", "$$", "\\binom{n"]) {
      expect(() => mathToSpeech(junk)).not.toThrow();
    }
  });
});
