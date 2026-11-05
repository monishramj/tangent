// Script text -> what the TTS should say. Pure, never throws.
// Two layers: `sp` speaks explicit math (LaTeX, $…$, O(…), x^2, a_i); `normalize` handles prose
// (markdown, abbreviations, lists, ranges, symbols) and finally turns every number into words,
// because the forced aligner only keeps tokens with letters: a digit would drop out of the word timeline.
// Output contains only letters and . , ? ! ' - : so the TTS never reads stray symbols.

const GREEK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho _ sigma tau upsilon phi chi psi omega".split(" ");
const UNI_LOWER = "αβγδεζηθικλμνξοπρ_στυφχψω";
const SYMBOLS: Record<string, string> = {
  le: "is less than or equal to", leq: "is less than or equal to", ge: "is greater than or equal to", geq: "is greater than or equal to",
  ne: "does not equal", neq: "does not equal", approx: "is approximately", pm: "plus or minus", mp: "minus or plus",
  cdot: "times", times: "times", div: "divided by", to: "goes to", rightarrow: "goes to", leftarrow: "comes from", infty: "infinity",
  in: "in", notin: "not in", subset: "is a subset of", subseteq: "is a subset of", cup: "union", cap: "intersection",
  emptyset: "the empty set", varnothing: "the empty set", forall: "for all", exists: "there exists", land: "and", lor: "or", neg: "not",
  Rightarrow: "implies", implies: "implies", iff: "if and only if", Leftrightarrow: "if and only if", sim: "is distributed as",
  mid: "given", bmod: "mod", mod: "mod", ldots: "dot dot dot", cdots: "dot dot dot", dots: "dot dot dot", equiv: "is equivalent to",
  lfloor: "floor of", lceil: "ceiling of", rfloor: "", rceil: "", partial: "partial", nabla: "nabla", prime: "prime", "%": "percent",
  sin: "sine", cos: "cosine", tan: "tangent", ln: "natural log", log: "log", lg: "log base 2", max: "max", min: "min", exp: "exp",
  Pr: "probability", Var: "variance", Cov: "covariance", "{": "the set", "}": "", "\\": " ", ",": " ", ";": " ", "!": " ", ":": " ", " ": " ",
  quad: " ", qquad: " ", displaystyle: "", textstyle: "", limits: "", nolimits: "",
};
const WORDS: Record<string, string> = { Var: "variance", Cov: "covariance", Pr: "probability" };
const UNI: Record<string, string> = {
  "≤": " is less than or equal to ", "≥": " is greater than or equal to ", "≠": " does not equal ", "≈": " is approximately ",
  "±": " plus or minus ", "×": " times ", "·": " times ", "÷": " divided by ", "→": " goes to ", "∞": " infinity ", "∈": " in ", "∑": " the sum of ",
  "²": "^2", "³": "^3", "√": " square root of ",
};
const CAPS = new Set(["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega", "Upsilon"]);
const ACCENT: Record<string, string> = { hat: "hat", bar: "bar", overline: "bar", tilde: "tilde", dot: "dot", vec: "vector", widehat: "hat" };
const PASS = new Set(["text", "textbf", "textit", "mathrm", "mathbf", "mathit", "mathcal", "mathbb", "operatorname", "mathsf", "boldsymbol"]);
const BIG = new Set(["sum", "prod", "int", "lim", "bigcup", "bigcap"]);
const BIGWORD: Record<string, string> = { sum: "the sum", prod: "the product", int: "the integral", lim: "the limit", bigcup: "the union", bigcap: "the intersection" };

const match = (s: string, i: number, open: string, close: string) => {
  for (let d = 0, j = i; j < s.length; j++) {
    if (s[j] === open) d++;
    else if (s[j] === close && --d === 0) return j;
  }
  return -1;
};

// Reads one TeX argument at i: {group}, \macro, or a single char. Returns [raw, nextIndex].
function arg(s: string, i: number): [string, number] {
  while (s[i] === " ") i++;
  if (i >= s.length) return ["", i];
  if (s[i] === "{") {
    const e = match(s, i, "{", "}");
    return e < 0 ? [s.slice(i + 1), s.length] : [s.slice(i + 1, e), e + 1];
  }
  const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
  return m ? [m[0], i + m[0].length] : [s[i], i + 1];
}

function digitRun(s: string, i: number): [string, number] | null {
  const m = /^\d+/.exec(s.slice(i));
  return m ? [m[0], i + m[0].length] : null;
}

// "O(" -> big O, "E[" -> expected value; applied to letter runs and wrapped letters alike.
function word(w: string, next: string): string {
  if (next === "(" && (w === "O" || w === "Theta" || w === "Omega")) return "big " + (w === "O" ? "O" : w.toLowerCase());
  if (next === "[" && w === "E") return "expected value";
  return WORDS[w] ?? w;
}

function power(raw: string): string {
  const r = raw.trim();
  if (!r) return "";
  if (r === "2") return "squared";
  if (r === "3") return "cubed";
  if (r === "-1") return "inverse";
  if (r === "T" || r === "\\top") return "transpose";
  if (r === "*") return "star";
  if (r === "\\prime" || r === "'") return "prime";
  const t = sp(r).trim();
  return t ? (/\s/.test(t) || /^\d/.test(t) ? "to the power of " : "to the ") + t : "";
}

// Splits on commas at bracket depth 0.
function topCommas(s: string): string[] {
  const parts: string[] = [];
  let d = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    if ("([{".includes(s[i])) d++;
    else if (")]}".includes(s[i])) d--;
    else if (s[i] === "," && d === 0) { parts.push(s.slice(last, i)); last = i + 1; }
  }
  parts.push(s.slice(last));
  return parts;
}

function sp(s: string): string {
  let o = "";
  let fn = false; // previous macro behaves like a function name, so "(" means "of"
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    const prev = s[i - 1] ?? "";
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/s.exec(s.slice(i))!;
      const name = m[1] ?? "";
      i += m[0].length;
      if (!m[0] || i > s.length) break;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [a, ia] = arg(s, i);
        const [b, ib] = arg(s, ia);
        i = ib;
        const n = sp(a), d = sp(b);
        const small: Record<string, string> = { "1/2": "one half", "1/3": "one third", "1/4": "one quarter" };
        o += ` ${small[`${a.trim()}/${b.trim()}`] ?? (!b.trim() ? n : /\s/.test(n + d) ? `${n} all over ${d}` : `${n} over ${d}`)} `;
      } else if (name === "binom") {
        const [a, ia] = arg(s, i);
        const [b, ib] = arg(s, ia);
        i = ib;
        o += ` ${sp(a)} choose ${sp(b)} `;
      } else if (name === "sqrt") {
        let idx = "";
        if (s[i] === "[") {
          const e = s.indexOf("]", i);
          idx = s.slice(i + 1, e < 0 ? s.length : e);
          i = e < 0 ? s.length : e + 1;
        }
        const [a, ia] = arg(s, i);
        i = ia;
        const t = sp(a);
        const root = idx.trim() === "3" ? "cube root" : idx && idx.trim() !== "2" ? `${sp(idx)} th root` : "square root";
        o += /\s/.test(t) ? ` the ${root} of ${t}, end root ` : ` ${root} of ${t} `;
      } else if (name in ACCENT) {
        const [a, ia] = arg(s, i);
        i = ia;
        o += name === "vec" ? ` vector ${sp(a)} ` : ` ${sp(a)} ${ACCENT[name]} `;
      } else if (PASS.has(name)) {
        const [a, ia] = arg(s, i);
        i = ia;
        const t = sp(a);
        const reals: Record<string, string> = { R: "the reals", N: "the naturals", Z: "the integers", Q: "the rationals" };
        o += ` ${name === "mathbb" && reals[t] ? reals[t] : word(t, s[i] ?? "")} `;
        fn = true;
      } else if (BIG.has(name)) {
        let lo = "", hi = "";
        for (let k = 0; k < 2; k++) {
          while (s[i] === " ") i++;
          if (s[i] === "_") [lo, i] = arg(s, i + 1);
          else if (s[i] === "^") [hi, i] = arg(s, i + 1);
        }
        const bits = [BIGWORD[name]];
        if (name === "lim") bits.push(lo ? `as ${sp(lo)}` : "");
        else bits.push(lo ? `from ${sp(lo)}` : "", hi ? `to ${sp(hi)}` : "");
        o += ` ${bits.filter(Boolean).join(" ")} of `;
      } else if (name === "log" || name === "lg") {
        let base = "";
        while (s[i] === " ") i++;
        if (s[i] === "_") [base, i] = arg(s, i + 1);
        o += base ? ` log base ${sp(base)} ` : name === "lg" ? " log base 2 " : " log ";
        fn = true;
      } else if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg") {
        if (s[i] === ".") i++;
      } else if (name in GREEK_MAP) {
        const g = GREEK_MAP[name];
        o += ` ${CAPS.has(name) ? (s[i] === "(" ? "big " : "capital ") + g : g} `;
        fn = true;
      } else if (name in SYMBOLS) {
        o += ` ${SYMBOLS[name]} `;
        fn = /^(sin|cos|tan|max|min|exp|ln|Pr|Var|Cov)$/.test(name);
      } else {
        o += ` ${name} `; // unknown macro: say its name
      }
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const w = /^[A-Za-z]+/.exec(s.slice(i))![0];
      i += w.length;
      o += (/[A-Za-z0-9]$/.test(o) ? " " : "") + word(w, s[i] ?? "");
      fn = false;
      continue;
    }
    const num = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(s.slice(i));
    if (num) {
      o += (/[A-Za-z0-9]$/.test(o) ? " " : "") + num[0];
      i += num[0].length;
      continue;
    }
    i++;
    if (UNI[c]) {
      o += c === "²" || c === "³" ? ` ${power(UNI[c].slice(1))} ` : UNI[c];
      continue;
    }
    const gi = UNI_LOWER.indexOf(c);
    if (gi >= 0 && c !== "_") { o += ` ${GREEK[gi]} `; continue; }
    switch (c) {
      // Unbraced digit runs are read whole (2^10 means 2^{10} in scripts, though TeX would take one digit).
      case "^": { const [a, n] = digitRun(s, i) ?? arg(s, i); i = n; o += ` ${power(a)} `; break; }
      case "_": { const [a, n] = digitRun(s, i) ?? arg(s, i); i = n; const t = sp(a); if (t) o += ` sub ${t} `; break; }
      case "{": { const e = match(s, i - 1, "{", "}"); const end = e < 0 ? s.length : e; o += ` ${sp(s.slice(i, end))} `; i = e < 0 ? s.length : e + 1; break; }
      case "}": case "$": case "&": case "~": break;
      case "(": case "[": {
        const close = c === "(" ? ")" : "]";
        const e = match(s, i - 1, c, close);
        const end = e < 0 ? s.length : e;
        const raw = s.slice(i, end);
        const inner = sp(raw);
        const call = fn || /[A-Za-z}]/.test(prev);
        const parts = topCommas(raw);
        o += call ? ` of ${inner} `
          : parts.length === 2 ? ` the interval from ${sp(parts[0])} to ${sp(parts[1])} `
          : parts.length > 2 ? ` ${parts.map(sp).join(", ")} ` : ` the quantity ${inner} `;
        i = e < 0 ? s.length : e + 1;
        fn = false;
        break;
      }
      case ")": case "]": break;
      case "=": o += " equals "; break;
      case "+": o += " plus "; break;
      case "<": o += " is less than "; break;
      case ">": o += " is greater than "; break;
      case "*": o += " times "; break;
      case "/": o += " over "; break;
      case "|": o += " given "; break;
      case "%": o += " percent "; break;
      case "'": o += " prime "; break;
      case "!": {
        const before = s.slice(0, i - 1);
        o += /(?:^|[^A-Za-z0-9])[A-Za-z]$|\d$|\)$|\}$/.test(before) ? " factorial " : "!";
        break;
      }
      case "-": {
        const binary = /[A-Za-z0-9)\]}]\s*$/.test(s.slice(0, i - 1));
        const hyphen = /[A-Za-z]{2}$/.test(s.slice(0, i - 1)) && /^[A-Za-z]/.test(s.slice(i));
        o += hyphen ? "-" : binary ? " minus " : " negative ";
        break;
      }
      default: o += c;
    }
  }
  return o;
}

const GREEK_MAP: Record<string, string> = {};
for (const g of GREEK) if (g !== "_") { GREEK_MAP[g] = g; GREEK_MAP[g[0].toUpperCase() + g.slice(1)] = g; }
GREEK_MAP.varepsilon = "epsilon"; GREEK_MAP.vartheta = "theta"; GREEK_MAP.varphi = "phi";
for (const k of Object.keys(GREEK_MAP)) if (/^[A-Z]/.test(k) && !CAPS.has(k)) delete GREEK_MAP[k]; // Alpha etc. are plain letters in LaTeX


// ---------- numbers -> words ----------
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", " thousand", " million", " billion", " trillion"];
const digitWords = (d: string) => [...d].map(c => ONES[+c]).join(" ");
function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100, out: string[] = [];
  if (h) out.push(`${ONES[h]} hundred`);
  if (r || !h) out.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? ` ${ONES[r % 10]}` : ""));
  return out.join(" ");
}
function cardinal(raw: string): string {
  const d = raw.replace(/,/g, "");
  if ((d.length > 1 && d[0] === "0") || d.length > 15) return digitWords(d); // "007", huge ids: digit by digit
  let n = Number(d);
  if (!n) return "zero";
  const groups: string[] = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) if (n % 1000) groups.unshift(under1000(n % 1000) + SCALES[i]);
  return groups.join(" ");
}
const ORD: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
const ordinal = (words: string) => words.replace(/\w+$/, w => ORD[w] ?? (w.endsWith("y") ? `${w.slice(0, -1)}ieth` : `${w}th`));
const plural = (words: string) => words.replace(/\w+$/, w => w.endsWith("y") ? `${w.slice(0, -1)}ies` : /(x|s)$/.test(w) ? `${w}es` : `${w}s`);
function year(n: number): string {
  if (n >= 2000 && n < 2010) return cardinal(String(n));
  const hi = Math.floor(n / 100), lo = n % 100;
  return `${cardinal(String(hi))} ${lo === 0 ? "hundred" : lo < 10 ? `oh ${ONES[lo]}` : cardinal(String(lo))}`;
}
const isYear = (d: string) => /^\d{4}$/.test(d) && +d >= 1100 && +d <= 2099;
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const YEAR_CONTEXT = new RegExp(`\\b(?:in|since|by|from|until|till|year|circa|around|before|after|during|of|early|late|mid|${MONTH})[\\s,]*$`, "i");
const DEN: Record<number, [string, string]> = { 2: ["half", "halves"], 4: ["quarter", "quarters"] };

function numbers(s: string): string {
  return s
    .replace(/\b0x([0-9a-f]+)\b/gi, (_, h: string) => ` hex ${[...h].map(c => /\d/.test(c) ? ONES[+c] : c.toUpperCase()).join(" ")} `)
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, (_, n: string) => `${n} ${n === "1" ? "dollar" : "dollars"}`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => ` ${cardinal(h)} ${m === "00" ? "o'clock" : m[0] === "0" ? `oh ${ONES[+m[1]]}` : cardinal(m)} `)
    .replace(/\b(\d+):(\d+)\b/g, "$1 to $2")
    .replace(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (_, a: string, b: string) => {
      const n = +a, d = +b;
      if (d < 2 || d > 10) return ` ${cardinal(a)} over ${cardinal(b)} `;
      const [one, many] = DEN[d] ?? [ordinal(cardinal(b)), plural(ordinal(cardinal(b)))];
      return ` ${cardinal(a)} ${n === 1 ? one : many} `;
    })
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (_, n: string) => ordinal(cardinal(n)))
    .replace(/\b(\d+(?:\.\d+)?)[x×](?![\p{L}\d])(?!\s*[-+=*/^])/gu, "$1 times")
    .replace(/'(\d0)s\b/g, (_, n: string) => plural(cardinal(n)))
    .replace(/\b(\d*0)s\b/g, (_, n: string) => plural(isYear(n) ? year(+n) : cardinal(n)))
    .replace(/\b\d{4}\b(?![.,]\d)/g, (d: string, at: number, all: string) => isYear(d) && YEAR_CONTEXT.test(all.slice(0, at)) ? year(+d) : d)
    .replace(/\b([A-Z]{2,})([a-z]{1,2})(?=\d)/g, "$1 $2") // LEGv8 -> LEG v8
    .replace(/(\p{L})(?=\d)/gu, "$1 ")
    .replace(/(\d)(?=\p{L})/gu, "$1 ")
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)?\.(\d+)|(\d{1,3}(?:,\d{3})+|\d+)/g, (_, i: string | undefined, f: string | undefined, n: string | undefined) =>
      ` ${n !== undefined ? cardinal(n) : `${i ? `${cardinal(i)} ` : ""}point ${digitWords(f!)}`} `);
}

// ---------- prose ----------
const PROSE_SYMBOLS: [RegExp, string][] = [
  [/≤/g, " is less than or equal to "], [/≥/g, " is greater than or equal to "], [/≠/g, " does not equal "],
  [/≈/g, " is approximately "], [/≡/g, " is equivalent to "], [/±/g, " plus or minus "], [/[×·]/g, " times "], [/÷/g, " divided by "],
  [/[⇒⟹]/g, " implies "], [/[⇔⟺↔]/g, " if and only if "], [/[→⟶]/g, " to "], [/[←⟵]/g, " gets "], [/∞/g, " infinity "],
  [/∑/g, " the sum of "], [/∏/g, " the product of "], [/∉/g, " not in "], [/∈/g, " in "], [/[⊆⊂]/g, " is a subset of "],
  [/∪/g, " union "], [/∩/g, " intersection "], [/¬/g, " not "], [/∧/g, " and "], [/∨/g, " or "], [/∀/g, " for all "],
  [/∃/g, " there exists "], [/∅/g, " the empty set "], [/√/g, " square root of "], [/[∆Δ]/g, " delta "], [/°/g, " degrees "],
  [/²/g, " squared "], [/³/g, " cubed "], [/∝/g, " is proportional to "], [/∂/g, " partial "], [/⌊/g, " floor of "], [/⌈/g, " ceiling of "],
  [/[⌋⌉]/g, " "], [/Θ/g, " theta "], [/Ω/g, " omega "], [/Σ/g, " sigma "], [/Π/g, " pi "],
];
const BIG_O: Record<string, string> = { O: "big O", "Θ": "big theta", "Ω": "big omega", Theta: "big theta", Omega: "big omega", o: "little o" };
// A token that is really math written inline: a LaTeX macro, x^2, a_i, x-1, a*b, n!, f', 2(…), n/2.
const MATHY = /\\[a-zA-Z]|[\p{L}\d)\]}]\^|[\p{L}\d}]_(?:\{|[\p{L}\d](?![\p{L}\d]))|(?<!\p{L})\p{L}-\d|[\p{L}\d)][+*=<>][\p{L}\d(]|\)!|(?<![\p{L}\d])(?:\p{L}|\d+)!(?![\p{L}\d])|(?<!\p{L})\p{L}'(?![\p{L}])|\d\(|(?<![\p{L}])\p{L}\/[\p{L}\d]|\d\/\p{L}|(?<!\p{L})E\[/u;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const speakMath = (m: string) => tidy(sp(m.replace(/\\(?:left|right|bigg?|Bigg?)(?![a-zA-Z])\s*\.?/g, "").replace(/\\[()[\]]/g, " ")));

// f(x) -> "f of x", O(n log n) -> "big O of n log n", item(s) -> items. Nested calls are rewritten too.
function calls(s: string, hold: (spoken: string) => string): string {
  const re = /([\p{L}][\p{L}\d_]*)\(/gu;
  for (let pos = 0; ;) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) return s;
    const start = m.index, open = start + m[0].length - 1;
    const close = match(s, open, "(", ")");
    if (/[\p{L}\d_\\]/u.test(s[start - 1] ?? "") || close < 0) { pos = open + 1; continue; }
    const name = m[1], inner = s.slice(open + 1, close);
    if (!(name in BIG_O) && inner.includes("|") && !inner.includes("||")) { // P(A|B): probability notation, all math
      const rep = ` ${hold(speakMath(s.slice(start, close + 1)))} `;
      s = s.slice(0, start) + rep + s.slice(close + 1);
      pos = start + rep.length;
    } else if (name in BIG_O) {
      const rep = ` ${BIG_O[name]} of ${hold(speakMath(inner.replace(/\|([^|]*)\|/g, "$1")))} `;
      s = s.slice(0, start) + rep + s.slice(close + 1);
      pos = start + rep.length;
    } else if (/^e?s$/.test(inner)) {
      s = s.slice(0, start) + name + inner + s.slice(close + 1);
      pos = start + name.length;
    } else {
      const head = ` ${name} of `;
      s = s.slice(0, start) + head + inner + " " + s.slice(close + 1);
      pos = start + head.length;
    }
  }
}

// Whitespace-separated tokens (braces kept whole); mathy ones are spoken by `sp`.
function mathTokens(s: string, hold: (spoken: string) => string): string {
  let out = "";
  for (let i = 0; i < s.length;) {
    if (/\s/.test(s[i])) { out += s[i++]; continue; }
    let j = i;
    for (let d = 0; j < s.length && (d > 0 || !/\s/.test(s[j])); j++) d = s[j] === "{" ? d + 1 : s[j] === "}" ? Math.max(0, d - 1) : d;
    const tok = s.slice(i, j);
    i = j;
    const [, body, tail] = /^(.*?)([.,;:?]*)$/s.exec(tok)!;
    out += !tok.includes("") && MATHY.test(body) ? hold(speakMath(body)) + tail : tok;
  }
  return out;
}

function normalize(input: string): string {
  const held: string[] = [];
  const hold = (spoken: string) => `${String.fromCharCode(0xE100 + held.push(spoken) - 1)}`;
  let s = input.normalize("NFC")
    .replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/−/g, "-").replace(/[   ]/g, " ").replace(/…/g, "...").replace(/\r\n?/g, "\n");

  // Code: drop the ticks, keep the text (O(1), i++ are spoken below).
  s = s.replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, " $1 ").replace(/`([^`\n]*)`/g, " $1 ").replace(/`/g, " ");

  // Explicit math first, before markdown can eat * and _.
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => hold(speakMath(m)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => hold(speakMath(m)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => hold(speakMath(m)))
    .replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, m: string) => hold(speakMath(m)));

  // Markdown.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/g, " ")
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, " ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+•][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/[ \t]*\n+[ \t]*/g, (_nl: string, at: number, all: string) => /[.?!:,;]$/.test(all.slice(0, at).trimEnd()) ? " " : ". ");

  // Abbreviations.
  s = s.replace(/\be\.\s?g\.,?/gi, "for example,").replace(/\bi\.\s?e\.,?/gi, "that is,")
    .replace(/\betc\.(?=\s*$|\s+[A-Z])/g, "and so on.").replace(/\betc\b\.?/gi, "and so on")
    .replace(/\bvs\b\.?/gi, "versus").replace(/\bw\.r\.t\./gi, "with respect to").replace(/\ba\.k\.a\./gi, "also known as")
    .replace(/\bcf\./gi, "compare").replace(/\bapprox\./gi, "approximately")
    .replace(/\bFigs?\.\s*/g, m => m.startsWith("Figs") ? "figures " : "figure ").replace(/\bEqs?\.\s*/g, "equation ")
    .replace(/\bCh\.\s*/g, "chapter ").replace(/\bSec\.\s*/g, "section ")
    .replace(/\bpp\.\s*(?=\d)/g, "pages ").replace(/\bp\.\s*(?=\d)/g, "page ").replace(/\bNo\.\s*(?=\d)/g, "number ")
    .replace(/\bDr\./g, "doctor").replace(/\bProf\./g, "professor");

  // Big-O written as LaTeX; then explicit interval notation (x ∈ [0, 1]).
  s = s.replace(/\\math(?:cal|rm|bf)?\{O\}/g, "O").replace(/\\Theta(?=\s*\()/g, "Θ").replace(/\\Omega(?=\s*\()/g, "Ω")
    .replace(/(∈|\\in(?![a-zA-Z]))\s*[[(]\s*([^,[\]()]+?)\s*,\s*([^,[\]()]+?)\s*[\])]/g, " in the interval from $2 to $3 ");

  // Multi-character operators (code and ASCII math).
  s = s.replace(/==/g, " equals ").replace(/!=/g, " does not equal ").replace(/<=/g, " is less than or equal to ")
    .replace(/>=/g, " is greater than or equal to ").replace(/&&/g, " and ").replace(/\|\|/g, " or ")
    .replace(/<->|<=>/g, " if and only if ").replace(/=>/g, " implies ").replace(/->/g, " to ").replace(/<-/g, " gets ")
    .replace(/\+\+/g, " plus plus ").replace(/([\p{L}\d])--(?=[\p{L}\d])/gu, "$1, ").replace(/([\p{L}\d])--|--(?=[\p{L}])/gu, "$1 minus minus ")
    .replace(/\s+--\s+/g, ", ");

  s = calls(s, hold);
  s = s.replace(/\b([A-Z])\/([A-Z])\b/g, "$1 $2").replace(/(\p{L}{2,})\/(\p{L}{2,})/gu, "$1 or $2");
  s = mathTokens(s, hold);

  // Lists and indexing: [3, 9, 7] is read as a list (intervals only in explicit math above).
  s = s.replace(/([\p{L}\d])\[([^[\]]+)\]/gu, "$1 at index $2 ").replace(/\[([^[\]]*)\]/g, " $1 ").replace(/\{([^{}]*)\}/g, " $1 ");

  // Ranges, dashes, minus and negatives.
  s = s.replace(/\b(\d)-(\d)(?:-(\d))?(?=[ -]trees?\b)/g, (_, a, b, c) => [a, b, c].filter(Boolean).join(" ")) // 2-3 tree
    .replace(/(\S)–(\S)/g, "$1 to $2")
    .replace(/([\p{L}]*\d[\p{L}\d.]*)\s+–\s+(?=[\p{L}]*\d)/gu, "$1 to ")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/(\d)-(?=\d)/g, "$1 to ")
    .replace(/\b([A-Za-z]+\d+)-(?=[A-Za-z]+\d+\b)/g, "$1 to ")
    .replace(/(\p{L}{2,})-(?=\d)/gu, "$1 ").replace(/(\d)-(?=\p{L})/gu, "$1 ")
    .replace(/(?<![\p{L}\d])(\p{L}|\d+(?:\.\d+)?)\s+-\s+(?=(?:\p{L}(?!\p{L})|\d))/gu, "$1 minus ")
    .replace(/(^|[\s([{,=:])-(?=\.?\d|\p{L}(?![\p{L}]))/gu, "$1negative ")
    .replace(/\s+-\s+/g, ", ");

  // Remaining symbols.
  for (const [re, word] of PROSE_SYMBOLS) s = s.replace(re, word);
  for (let i = 0; i < UNI_LOWER.length; i++) if (GREEK[i] !== "_") s = s.split(UNI_LOWER[i]).join(` ${GREEK[i]} `);
  s = s.replace(/([\p{L})])\s+%\s+(?=[\p{L}\d])/gu, "$1 mod ").replace(/%/g, " percent ")
    .replace(/(\S)\s+\*\s+(?=\S)/g, "$1 times ").replace(/\*/g, " ")
    .replace(/~\s*(?=\d)/g, "about ").replace(/#\s*(?=\d)/g, "number ")
    .replace(/\^/g, " to the power of ").replace(/\s=\s|=/g, " equals ").replace(/</g, " is less than ").replace(/>/g, " is greater than ")
    .replace(/\+/g, " plus ").replace(/&/g, " and ").replace(/@/g, " at ")
    .replace(/(?<=\p{L})!(?=[\p{L}\d])/gu, " ") // stray ! inside a word
    .replace(/[()]/g, ", ").replace(/;/g, ",").replace(/[[\]{}"|\\~#_]/g, " ");

  // Restore spoken math, then numbers become words.
  for (let k = 0; k < 3 && s.includes(""); k++) s = s.replace(/(.)/gs, (_, c: string) => ` ${held[c.charCodeAt(0) - 0xE100] ?? ""} `);
  s = numbers(s);

  return s
    .replace(/\b([A-Z]+)\/([A-Z]+)\b/g, "$1 $2").replace(/\//g, " over ")
    .replace(/(^|\s)'+|'+(?=\s|$|[,.?!:])/g, "$1")
    .replace(/[^\p{L}\p{M}' .,?!:-]/gu, " ")
    .replace(/(?<!\p{L})-|-(?!\p{L})/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.?!:])/g, "$1")
    .replace(/([,:])(?:\s*[,:])+/g, "$1")
    .replace(/[,:]\s*([.?!])/g, "$1")
    .replace(/([.?!])\s*[,:]/g, "$1")
    .replace(/(^|[.?!]\s)\s*[,:]\s*/g, "$1")
    .replace(/^[\s,.:!?]+/, "")
    .replace(/[,:]$/, "")
    .trim();
}

export function mathToSpeech(text: string): string {
  try {
    return normalize(text);
  } catch {
    // Last resort: never ship symbols or digits to the TTS.
    return text.replace(/[^\p{L}' .,?!:-]/gu, " ").replace(/\s+/g, " ").trim();
  }
}
