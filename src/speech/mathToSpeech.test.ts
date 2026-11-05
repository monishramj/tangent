import { describe, expect, it } from "vitest";
import { mathToSpeech } from "./mathToSpeech";

const cases: [string, string][] = [
  // regressions from real scripts (garbage the old normalizer produced)
  ["The array [3, 9, 7] has 3 items.", "The array three, nine, seven has three items."],
  ["**Big O** is `O(1)`", "Big O is big O of one"],
  ["Registers X0–X31 hold values.", "Registers X zero to X thirty one hold values."],
  ["X0-X31", "X zero to X thirty one"],
  ["It takes ~5 ms, e.g. a cache hit.", "It takes about five ms, for example, a cache hit."],
  ["LEGv8 has 32 registers.", "LEG v eight has thirty two registers."],
  ["COVID-19 and i7 chips.", "COVID nineteen and i seven chips."],
  // markdown
  ["*Heaps* are __trees__.", "Heaps are trees."],
  ["# Heaps\n- first point\n- second point", "Heaps. first point. second point"],
  ["See [the docs](http://example.com/x) now.", "See the docs now."],
  ["Use `i++` here.", "Use i plus plus here."],
  ["Visit https://example.com today.", "Visit today."],
  ["> Quoted line.", "Quoted line."],
  ["1. First step.", "First step."],
  // abbreviations
  ["Trees, i.e., graphs.", "Trees, that is, graphs."],
  ["Arrays vs. lists, etc.", "Arrays versus lists, and so on."],
  ["See Fig. 4.12 on p. 287.", "See figure four point one two on page two hundred eighty seven."],
  // intervals only in math, lists otherwise
  ["x ∈ [0, 1]", "x in the interval from zero to one"],
  ["$x \\in [0, 1]$", "x in the interval from zero to one"],
  ["Values [1, 2] stay.", "Values one, two stay."],
  ["A[0] is the root.", "A at index zero is the root."],
  // ranges
  ["pages 3–5", "pages three to five"],
  ["Steps 1-10 repeat.", "Steps one to ten repeat."],
  ["A 2-3 tree", "A two three tree"],
  ["It is fast — really fast.", "It is fast, really fast."],
  // numbers
  ["In 2026 we had 1024 bytes.", "In twenty twenty six we had one thousand twenty four bytes."],
  ["Since 1905, and in 2005.", "Since nineteen oh five, and in two thousand five."],
  ["The 1990s and the '80s.", "The nineteen nineties and the eighties."],
  ["It is 2.5x faster, 10x cheaper.", "It is two point five times faster, ten times cheaper."],
  ["The 3rd and 21st items.", "The third and twenty first items."],
  ["Use 1/2 or 3/4 or 2/3.", "Use one half or three quarters or two thirds."],
  ["1,000,000 users", "one million users"],
  ["3.14", "three point one four"],
  ["0.5 and .25", "zero point five and point two five"],
  ["50% of 8GB", "fifty percent of eight GB"],
  ["At 10:30 and 10:05.", "At ten thirty and ten oh five."],
  ["It costs $5.", "It costs five dollars."],
  ["-5 degrees", "negative five degrees"],
  ["Version 1.2.3", "Version one point two point three"],
  ["3D graphics", "three D graphics"],
  ["0x1F", "hex one F"],
  // code and ASCII operators
  ["i++ and C++ and a == b", "i plus plus and C plus plus and a equals b"],
  ["if a != b && c <= d || e >= f", "if a does not equal b and c is less than or equal to d or e is greater than or equal to f"],
  ["x <- 5", "x gets five"],
  ["a % b", "a mod b"],
  ["read/write and I/O", "read or write and I O"],
  ["max_heap", "max heap"],
  // unicode symbols
  ["u → v ⇒ w ≤ 3", "u to v implies w is less than or equal to three"],
  ["A × B ÷ C ± D", "A times B divided by C plus or minus D"],
  ["x ≠ ∞", "x does not equal infinity"],
  ["x ∉ S ⊂ T", "x not in S is a subset of T"],
  ["A ∪ B ∩ C", "A union B intersection C"],
  ["¬p ∧ q ∨ r", "not p and q or r"],
  ["∑ x", "the sum of x"],
  ["α ≤ β", "alpha is less than or equal to beta"],
  ["n² + π", "n squared plus pi"],
  // complexity
  ["O(n \\log n)", "big O of n log n"],
  ["O(n^2)", "big O of n squared"],
  ["$O(1)$", "big O of one"],
  ["\\Theta(n)", "big theta of n"],
  ["Θ(n²)", "big theta of n squared"],
  ["\\mathcal{O}(n \\log n)", "big O of n log n"],
  ["O(2^n)", "big O of two to the n"],
  ["O(|V| + |E|)", "big O of V plus E"],
  ["Heapify(A) runs in O(log n) time.", "Heapify of A runs in big O of log n time."],
  ["item(s)", "items"],
  ["\\log_2 n", "log base two n"],
  ["\\log_2(n)", "log base two of n"],
  ["\\ln x", "natural log x"],
  // powers and subscripts
  ["x^2", "x squared"],
  ["x^{n+1}", "x to the power of n plus one"],
  ["2^10", "two to the power of ten"],
  ["e^{-x^2}", "e to the power of negative x squared"],
  ["A^{-1}", "A inverse"],
  ["A^T", "A transpose"],
  ["f'", "f prime"],
  ["x_i", "x sub i"],
  ["x_{i+1}", "x sub i plus one"],
  ["a_1 + a_2", "a sub one plus a sub two"],
  ["x_i^2", "x sub i squared"],
  // fractions, roots, sums
  ["\\frac{1}{2}", "one half"],
  ["\\frac{1}{n}", "one over n"],
  ["\\frac{a+b}{c}", "a plus b all over c"],
  ["\\sqrt{x}", "square root of x"],
  ["\\sqrt[3]{x}", "cube root of x"],
  ["n/2", "n over two"],
  ["\\sum_{i=1}^{n} i", "the sum from i equals one to n of i"],
  ["\\int_0^1 f(x) dx", "the integral from zero to one of f of x dx"],
  ["\\lim_{x \\to 0} f(x)", "the limit as x goes to zero of f of x"],
  ["\\binom{n}{k}", "n choose k"],
  ["n!", "n factorial"],
  ["(n-1)!", "the quantity n minus one factorial"],
  ["5!", "five factorial"],
  ["T(n) = 2T(n/2) + n", "T of n equals two T of n over two plus n"],
  // stats
  ["P(A|B)", "P of A given B"],
  ["E[X]", "expected value of X"],
  ["\\mathbb{E}[X^2]", "expected value of X squared"],
  ["\\text{Var}(X)", "variance of X"],
  ["$X \\sim N(0, 1)$", "X is distributed as N of zero, one"],
  ["\\hat{\\beta}", "beta hat"],
  ["\\alpha = 0.05", "alpha equals zero point zero five"],
  ["$(a, b, c)$", "a, b, c"],
  // relations in LaTeX
  ["x \\le y", "x is less than or equal to y"],
  ["a \\neq b", "a does not equal b"],
  ["\\forall x \\exists y", "for all x there exists y"],
  ["x \\to \\infty", "x goes to infinity"],
  ["\\lfloor n/2 \\rfloor", "floor of n over two"],
  ["x - 1", "x minus one"],
  ["x-1", "x minus one"],
  ["(a+b)^2", "the quantity a plus b squared"],
  // prose passes through
  ["Heapify fixes one broken spot.", "Heapify fixes one broken spot."],
  ["A well-known result", "A well-known result"],
  ["Wow! Great. Really?", "Wow! Great. Really?"],
  ["Don't stop: it's fine.", "Don't stop: it's fine."],
  ["The cost is $O(n)$ per step.", "The cost is big O of n per step."],
  ["He said \"hi\" (quietly).", "He said hi, quietly."],
  // malformed input never throws and stays speakable
  ["\\foo{x}", "foo x"],
  ["\\weirdmacro + 1", "weirdmacro plus one"],
  ["\\frac{1", "one"],
  ["x^{", "x"],
  ["}{", ""],
  ["", ""],
];

describe("mathToSpeech", () => {
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(mathToSpeech(input)).toBe(expected);
  });

  it("emits only words and basic punctuation for every case and for junk", () => {
    const junk = ["\\", "^", "_", "\\frac", "\\sqrt[", "((((", "\\sum_^", "$$", "\\binom{n", "<<>>", "→→", "**", "`", "[[]]", "😀 emoji", "a\u0000b", "#$%&*@"];
    for (const input of [...cases.map(c => c[0]), ...junk]) {
      let out = "";
      expect(() => { out = mathToSpeech(input); }).not.toThrow();
      expect(out).toMatch(/^[\p{L}\p{M}' .,?!:-]*$/u);
      expect(out).not.toMatch(/\d/);
    }
  });
});
