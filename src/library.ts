// Parse a PDF once (cached IR, figures in app data), with honest progress.
import { figuresDir, ingestPdf, pdfInfo, type IR } from "./home/api";
import { irCache, sourceFor, tauriJsonStore, type JsonStore } from "./storage/store";

export type LoadProgress = { fraction: number; label: string };
const RATE_KEY = "tangent.secPerPage"; // learned from past ingests, so the estimate improves with use
const rate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 1.2; } catch { return 1.2; } };

/** Cached IR, else Docling ingest. Docling gives no callbacks, so progress = elapsed vs. pages x learned sec/page, capped at 95%. */
export async function loadIr(pdfPath: string, onProgress?: (p: LoadProgress) => void, store: JsonStore = tauriJsonStore): Promise<IR> {
  const source = sourceFor(pdfPath);
  const cached = await irCache(store).get(source.id).catch(() => null);
  if (cached) return cached;
  const pages = await pdfInfo(pdfPath).then(r => r.pages, () => 0);
  const expected = Math.max(10, pages * rate()), start = Date.now();
  const tick = () => {
    const sec = (Date.now() - start) / 1000, left = Math.max(0, expected - sec);
    onProgress?.({ fraction: Math.min(.95, sec / expected), label: `Reading ${pages ? `${pages} pages` : "PDF"} · ${left > 60 ? `~${Math.ceil(left / 60)} min` : left > 5 ? `~${Math.ceil(left)} s` : "almost done"}` });
  };
  tick();
  const h = setInterval(tick, 500);
  try {
    const dir = await figuresDir(source.id).catch(() => undefined);
    const ir = await ingestPdf(pdfPath, dir);
    if (pages) try { localStorage.setItem(RATE_KEY, String((Date.now() - start) / 1000 / pages)); } catch { /* fine */ }
    onProgress?.({ fraction: 1, label: "Done" });
    await irCache(store).set(source.id, ir).catch(() => {});
    return ir;
  } finally { clearInterval(h); }
}
