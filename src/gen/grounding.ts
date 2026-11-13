// Deterministic grounding gate for numeric claims (docs/generation-accuracy.md, item 1).
// Invented numbers are the most damaging and the easiest hallucination to catch without a model: every number a
// script beat says, or a scene puts on screen, must also appear in the source (or, for scenes, in the narration).
// Small counts (integers 0-10) are exempt: "two kinds", "step 1" and exponents are almost never fabricated facts,
// and flagging them would cost repairs for nothing. Percentages, decimals, big numbers and scaled numbers are checked.

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const WORD: Record<string, number> = Object.fromEntries([...UNITS.map((w, i) => [w, i]), ...TENS.map((w, i) => [w, i * 10]).filter(([w]) => w)]);
const PERCENT = /^(?:%|percent\b|per cent\b)/i;

export type NumberHit = { raw: string; value: number; decimals: number; percent: boolean; scaled: boolean };

/** Numbers in `text`: digit tokens ("1,000", "3.5", "50%", "3 million") and spelled-out runs ("fifty", "two hundred").
 *  `strict` skips digits glued to a preceding letter ("LEGv8", "H2O", "p12"), which are names, not quantities. */
export function numbersIn(text: string, strict = true): NumberHit[] {
  const out: NumberHit[] = [];
  const digits = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;
  for (let m; (m = digits.exec(text));) {
    const before = text[m.index - 1] ?? "";
    if (before === "." && /\d/.test(text[m.index - 2] ?? "")) continue; // fractional part already consumed
    if (strict && /[A-Za-z_]/.test(before)) continue;
    const after = text.slice(m.index + m[0].length).replace(/^\s+/, "");
    const scale = /^(hundred|thousand|million|billion|trillion)\b/i.exec(after);
    const base = Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : ""));
    out.push({ raw: m[0] + (text[m.index + m[0].length] === "%" ? "%" : ""), value: scale ? base * SCALES[scale[1].toLowerCase()] : base, decimals: m[2]?.length ?? 0,
      percent: PERCENT.test(after), scaled: !!scale });
  }
  // Spelled-out runs: "two hundred fifty thousand" = 250000; "a hundred" = 100.
  const words = text.toLowerCase().match(/[a-z]+|[^a-z\s]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lead = w === "a" && SCALES[words[i + 1]] !== undefined;
    if (WORD[w] === undefined && !lead) continue;
    let total = 0, cur = lead ? 1 : 0, j = lead ? i + 1 : i, raw: string[] = lead ? ["a"] : [];
    for (; j < words.length; j++) {
      const t = words[j];
      if (WORD[t] !== undefined) cur += WORD[t];
      else if (SCALES[t] !== undefined) { cur = (cur || 1) * SCALES[t]; if (SCALES[t] >= 1e3) { total += cur; cur = 0; } }
      else if (t === "and" && raw.length && (WORD[words[j + 1]] !== undefined)) { raw.push(t); continue; }
      else if (t === "-" && WORD[words[j + 1]] !== undefined) continue;
      else break;
      raw.push(t);
    }
    const scaled = raw.some(t => SCALES[t] !== undefined);
    out.push({ raw: raw.join(" "), value: total + cur, decimals: 0, percent: PERCENT.test(words.slice(j).join(" ")), scaled });
    i = j - 1;
  }
  return out;
}

/** Whether a number is a checkable claim rather than a small count. */
export const isClaim = (n: NumberHit) => n.value > 10 || n.decimals > 0 || n.percent || n.scaled;

/** Every value the source states, spelled out or in digits, plus fraction/percent twins (0.5 ~ 50%). */
export function supportSet(...texts: string[]): number[] {
  const values = new Set<number>();
  for (const text of texts) {
    for (const n of numbersIn(text, false)) values.add(n.value);
    if (/\bsquared\b/i.test(text)) values.add(2);
    if (/\bcubed\b/i.test(text)) values.add(3);
    if (/\bhalf\b/i.test(text)) values.add(0.5);
    if (/%|\bper ?cent\b/i.test(text)) values.add(100);
  }
  return [...values];
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** A claim is supported by an equal source value, the same value as a percent or fraction, or a source value that
 *  rounds to it at the claim's precision ("33%" from "33.3%"). */
export function supported(n: NumberHit, support: number[]): boolean {
  return support.some(s => near(s, n.value) || near(s * 100, n.value) || near(s, n.value * 100) || near(round(s, n.decimals), n.value));
}

/** The checkable numbers in `claim` that no value in `support` backs. A number the claim derives from its own grounded
 *  operands ("3 over 29 times 5 over 29 is 15 over 29 squared") is accepted when it is their sum, difference, product
 *  or quotient: worked arithmetic shown on the page, not a new fact. */
export function unsupportedNumbers(claim: string, support: number[]): string[] {
  const hits = numbersIn(claim);
  const operands = hits.filter(n => !isClaim(n) || supported(n, support)).map(n => n.value);
  const derived = (v: number) => operands.some((a, i) => operands.some((b, j) => i !== j &&
    [a + b, a - b, a * b, b ? a / b : NaN].some(x => near(x, v))));
  return [...new Set(hits.filter(n => isClaim(n) && !supported(n, support) && !derived(n.value)).map(n => n.raw))];
}

// Template data that is illustrative or computed, not a factual claim: example arrays/trees, code, math, layout
// numbers. Their numbers are never checked (CLAUDE.md: computed visuals come from code).
const ILLUSTRATIVE = new Set(["array", "tree", "stack", "queue", "linkedlist", "graph", "matrix", "code", "math", "encoding",
  "pipeline", "numberline", "scale", "race", "gif", "figure"]);
// Keys that hold ids, timing phrases, layout or styling, never a claim.
const SKIP_KEYS = new Set(["at", "icon", "emoji", "query", "src", "id", "from", "to", "variant", "decimals", "min", "max",
  "step", "focus", "highlight", "highlightRows", "weight", "bits", "word", "args", "op", "ops", "pose", "poseTo", "kind", "shape"]);

/** Text and numeric leaves of a template's data that would show a quantity on screen. */
export function screenText(template: string | undefined, data: unknown): string[] {
  if (!template || ILLUSTRATIVE.has(template)) return [];
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (SKIP_KEYS.has(key)) return;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number" && Number.isFinite(v)) out.push(String(v));
    else if (Array.isArray(v)) v.forEach(x => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(data);
  // A stat's suffix belongs to its value: {value: 40, suffix: "%"} is the claim "40%".
  const d = data as { value?: unknown; suffix?: unknown } | undefined;
  if (template === "stat" && typeof d?.value === "number" && typeof d.suffix === "string" && PERCENT.test(d.suffix.trim())) out.push(`${d.value}%`);
  return out;
}
