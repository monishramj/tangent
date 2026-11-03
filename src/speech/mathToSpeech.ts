// Pure LaTeX/symbol text -> spoken English for TTS. Never throws; unknown macros are spoken by name.

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
  const t = sp(r);
  return t ? (/\s/.test(t) ? "to the power " : "to the ") + t : "";
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
      case "^": { const [a, n] = arg(s, i); i = n; o += ` ${power(a)} `; break; }
      case "_": { const [a, n] = arg(s, i); i = n; const t = sp(a); if (t) o += ` sub ${t} `; break; }
      case "{": { const e = match(s, i - 1, "{", "}"); const end = e < 0 ? s.length : e; o += ` ${sp(s.slice(i, end))} `; i = e < 0 ? s.length : e + 1; break; }
      case "}": case "$": case "&": case "~": break;
      case "(": case "[": {
        const close = c === "(" ? ")" : "]";
        const e = match(s, i - 1, c, close);
        const end = e < 0 ? s.length : e;
        const inner = sp(s.slice(i, end));
        const call = fn || /[A-Za-z}]/.test(prev);
        o += call ? ` of ${inner} ` : ` ${inner.includes(",") ? "the interval" : "the quantity"} ${inner} `;
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

export function mathToSpeech(text: string): string {
  try {
    return sp(text.replace(/\\(?:left|right|bigg?|Bigg?)(?![a-zA-Z])\s*\.?/g, "").replace(/\\[()[\]]/g, " "))
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:?!])/g, "$1")
      .trim();
  } catch {
    return text; // ponytail: last-resort passthrough; the parser has no known throwing paths
  }
}
