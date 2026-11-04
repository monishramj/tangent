// App-level glue for projects: parse a source once (cached IR, figures in app data), with honest progress.
import { figuresDir, ingestPdf, listSections, pdfInfo, type IR, type SectionRef } from "./home/api";
import { irCache, tauriJsonStore, type JsonStore, type Source } from "./storage/projects";

export type LoadProgress = { fraction: number; label: string };
const RATE_KEY = "tangent.secPerPage"; // learned from past ingests, so the estimate improves with use
const rate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 1.2; } catch { return 1.2; } };

/** Cached IR, else Docling ingest. Docling gives no callbacks, so progress = elapsed vs. pages x learned sec/page, capped at 95%. */
export async function loadIr(source: Source, onProgress?: (p: LoadProgress) => void, store: JsonStore = tauriJsonStore): Promise<IR> {
  const cached = await irCache(store).get(source.id).catch(() => null);
  if (cached) return cached;
  const pages = await pdfInfo(source.pdfPath).then(r => r.pages, () => 0);
  const expected = Math.max(10, pages * rate()), start = Date.now();
  const tick = () => {
    const sec = (Date.now() - start) / 1000, left = Math.max(0, expected - sec);
    onProgress?.({ fraction: Math.min(.95, sec / expected), label: `Reading ${pages ? `${pages} pages` : "PDF"} · ${left > 60 ? `~${Math.ceil(left / 60)} min` : left > 5 ? `~${Math.ceil(left)} s` : "almost done"}` });
  };
  tick();
  const h = setInterval(tick, 500);
  try {
    const ir = await ingestPdf(source.pdfPath, await figuresDir(source.id));
    if (pages) try { localStorage.setItem(RATE_KEY, String((Date.now() - start) / 1000 / pages)); } catch { /* fine */ }
    onProgress?.({ fraction: 1, label: "Done" });
    await irCache(store).set(source.id, ir).catch(() => {});
    return ir;
  } finally { clearInterval(h); }
}

export async function loadSections(source: Source, onProgress?: (p: LoadProgress) => void, store?: JsonStore): Promise<SectionRef[]> {
  return listSections(await loadIr(source, onProgress, store));
}
