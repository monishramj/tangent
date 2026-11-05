// Pure distribution math shared by the distribution template (shaded area value) and renderer (curve). Never from the LLM.
export type Dist = { kind: "normal" | "uniform" | "binomial"; mean: number; sd: number; min: number; max: number; n: number; p: number };

/** erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const s = Math.sign(x), t = 1 / (1 + .3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normalCdf = (x: number, mean = 0, sd = 1) => .5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
function choose(n: number, k: number) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
export const binomialPmf = (k: number, n: number, p: number) => k < 0 || k > n ? 0 : choose(n, k) * p ** k * (1 - p) ** (n - k);

/** Density (pmf for binomial) at x. */
export function density(d: Dist, x: number): number {
  if (d.kind === "normal") return Math.exp(-(((x - d.mean) / d.sd) ** 2) / 2) / (d.sd * Math.sqrt(2 * Math.PI));
  if (d.kind === "uniform") return x >= d.min && x <= d.max ? 1 / (d.max - d.min) : 0;
  return binomialPmf(Math.round(x), d.n, d.p);
}

/** P(a <= X <= b); a/b undefined mean an open end. Binomial counts the integers in [a, b]. */
export function area(d: Dist, a = -Infinity, b = Infinity): number {
  if (d.kind === "normal") return normalCdf(b, d.mean, d.sd) - normalCdf(a, d.mean, d.sd);
  if (d.kind === "uniform") return Math.max(0, Math.min(b, d.max) - Math.max(a, d.min)) / (d.max - d.min);
  let s = 0;
  for (let k = Math.max(0, Math.ceil(a)); k <= Math.min(d.n, Math.floor(b)); k++) s += binomialPmf(k, d.n, d.p);
  return s;
}

/** Plotted x range. */
export function domain(d: Dist): [number, number] {
  if (d.kind === "normal") return [d.mean - 4 * d.sd, d.mean + 4 * d.sd];
  if (d.kind === "uniform") { const pad = (d.max - d.min) * .3; return [d.min - pad, d.max + pad]; }
  return [-.5, d.n + .5];
}
/** Peak density on the domain (for vertical scaling). */
export function peak(d: Dist): number {
  if (d.kind === "binomial") return Math.max(...Array.from({ length: d.n + 1 }, (_, k) => binomialPmf(k, d.n, d.p)));
  return d.kind === "normal" ? density(d, d.mean) : 1 / (d.max - d.min);
}

/** Numberline values map onto the middle NL_SPAN of its width (the ends hold the arrowheads). */
export const NL_SPAN = .9;
/** Stage-x of value v on a numberline object with explicit x and width. */
export const numberlineX = (o: { x?: unknown; width?: number; min: number; max: number }, v: number) =>
  (typeof o.x === "number" ? o.x : .5) + ((v - o.min) / (o.max - o.min) - .5) * (o.width ?? .8) * NL_SPAN;
