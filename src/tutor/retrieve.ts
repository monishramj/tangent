// Tiny keyword-overlap retriever: pick the section passages most related to the question, so a cheap model
// gets the relevant 4-6k chars instead of a whole chapter. No embeddings, no deps; good enough for one section.
const STOP = new Set(("a an and are as at be but by can do does for from has have how i if in into is it its of on or so " +
  "that the their then there these this to was we what when where which who why will with you your just also than not " +
  "very about after again all any because been before being both each few more most other over same some such only own " +
  "too under until up down out off once here they them our ours me my mine he she his her would should could get got").split(" "));

/** Lowercase word stems: drops stopwords and 1-2 letter tokens, strips simple plural/verb endings. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(w => w.endsWith("ss") ? w : w.replace(/ies$/, "y").replace(/(?:ing|ed|s)$/, "") || w);
}

/** Paragraphs (blank-line separated); a short heading-like paragraph is glued to the one after it. */
export function paragraphs(section: string): string[] {
  const raw = section.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  let carry = "";
  for (const p of raw) {
    if (p.length < 80 && !/[.!?]$/.test(p)) { carry = carry ? `${carry}\n${p}` : p; continue; }
    out.push(carry ? `${carry}\n${p}` : p);
    carry = "";
  }
  if (carry) out.push(carry);
  return out;
}

/** Top-k passages by idf-weighted term overlap with `query`, in section order, within `maxChars`.
 *  With no overlap at all, the opening passages (usually the definitions) are returned. */
export function retrievePassages(section: string, query: string, { k = 4, maxChars = 6000 } = {}): string[] {
  const paras = paragraphs(section);
  if (!paras.length) return [];
  const sets = paras.map(p => new Set(terms(p)));
  const q = [...new Set(terms(query))];
  const idf = (t: string) => Math.log(1 + paras.length / (1 + sets.filter(s => s.has(t)).length));
  const scored = paras.map((_, i) => ({ i, score: q.reduce((sum, t) => sum + (sets[i].has(t) ? idf(t) : 0), 0) }));
  const ranked = scored.some(s => s.score > 0)
    ? scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)
    : scored;
  const picked: number[] = [];
  let used = 0;
  for (const { i } of ranked) {
    if (picked.length >= k || used >= maxChars) break;
    picked.push(i);
    used += Math.min(paras[i].length, maxChars - used);
  }
  let budget = maxChars;
  return picked.sort((a, b) => a - b).map(i => {
    const p = paras[i].length > budget ? paras[i].slice(0, Math.max(0, budget - 1)) + "…" : paras[i];
    budget -= p.length;
    return p;
  }).filter(p => p.length > 1);
}
