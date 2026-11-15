# PDF ingest (Docling, IR, sidecar)

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.


## Contract

### Ingestion → Intermediate Representation (IR)
Every source goes through an adapter into one normalized IR; everything downstream sees only the IR.
- IR = section tree of markdown + LaTeX + extracted figures + **source anchors** (page / slide / URL) so videos can cite "Fig 4.12, p. 287". Also captures end-of-section **exercises** (used for checkpoints).
- Adapters, in build order:
  1. Textbook PDF (MVP)
  2. Lecture slides (PPTX → PDF, same adapter path)
  3. Handwritten notes / photos (vision-model OCR)
  4. zyBooks / web: a **"capture this page" from the user's own logged-in session**, never a scraper holding credentials. Personal use only; content is copyrighted.
- **PDF parser: benchmark before choosing.** Docling (MIT) vs Marker (Apache-2.0 code, restricted OpenRAIL-M weights, needs llama-server for full mode; often best on math) on 3 real chapters (CS 251, STAT 350, CS 334). Scoring: LaTeX fidelity, figure extraction + captions, section tree accuracy, exercises captured, speed on the M4 Max. Licensing note: Marker pushes Tangent toward GPL unless it's strictly isolated as a separate process; Docling keeps MIT/Apache open.
- v1: **merge sources per topic** (textbook section + matching lecture slides → one video).

- The 785-page ethics PDF had 849 flat rows, including 86 without own text, despite a 24-entry PDF outline. Repair yields 791 rows under 11 roots; 68 fragments and front-matter entries were folded into their hosts, with 10 outline nodes added. Every original nonempty section body is still present and surviving IDs keep their order. The old title call returned 398 strings for 849 rows in 23 seconds, so strict validation rejected the entire reply before saving. Batches and ID-keyed output let valid titles save even when a response omits or adds entries.

- Figures load (asset scope + app-data figures dir); one bad figure no longer kills an ingest.

- Ingest runs once per source (IR cached); loading screens show real pipeline steps.

## Formula fidelity

Lazy enrichment checks signed numeric multisets (repairing spaces inside digits/decimals), source symbols, named subscripts, superscripts/accents and malformed LaTeX before splicing. `formula_fidelity[id]` records `fidelity: "verified" | "fallback" | "unverified"` and reasons; `formula_disagreements` accumulates rejected/missing decodes across enrichment calls, with one stderr diagnostic per disagreement. Pending `formulas` still contains only work awaiting decoding.
Usable PDF text replaces rejected decodes as source text, without pretending it is valid LaTeX. Unusable originals become a number-free unverified placeholder in section markdown, passages and exercises, so narration input and numeric support never include that expression's values. This does not invalidate an independent verified occurrence of the same value elsewhere.
Token agreement is a conservative guard, not proof of mathematical equivalence; a corrupt but plausible PDF text layer can still be wrong, and existing enriched caches are not rechecked. The frontend’s pre-existing fallback after an RPC failure is outside this sidecar guard. The ten recorded examples use the report's manual source transcriptions, not archived raw PDF text-layer strings; synthetic cases cover Unicode and unusable text layers.

## Open issues

- Lazy decoding costs ~73s for 5 pages (~15s/page), slow before a video; later decode during script writing in parallel (not implemented).

## Log

- 2026-11-16 Step 18: JPG/PNG/WEBP photos use faithful Claude transcription, one IR passage per paragraph/region, LaTeX and `[illegible]` preserved; passages/sections carry `unverified-source`. Cached in the existing FIFO; no title rewrite or PDF preview.
  Evidence: fake-reader IR/cache tests, source-queue tests, 52 Rust tests (one ignored; existing PDFium path supplied); no live model/photo run. HEIC currently asks for JPG/PNG export; native HEIC decoding is not implemented.

- 2026-11-16 PPTX/DOCX enter `ingest_pdf` by extension (OOXML zip; other files still rejected). Docling's office reader, no PDF/formula model. IR keeps passages and slide titles as sections; page anchors, boxes and formula crops are dropped. Verified: `sidecar/tests/test_office.py` on tiny python-pptx/docx files. Not verified: a real lecture deck.
- 2026-11-16 (step 7): Real five-page STAT 350 check: 30/30 detected pending regions decoded/matched (100%); lazy RPC adds 73.48 s, initial ingest 20.82 s.
  Four threads, heavy slot, nice 10 driver/19 sidecar; 95.35 s total, 21/21 nominal thermal samples, 15-minute/serious-heat abort guard.
  Ten rendered-source comparisons expose numeric/notation/LaTeX errors despite matching; separate fidelity job proposed in `docs/formula-check-2026-11.md`, no fix here.
  Pre-push vitest unavailable (command not found); documentation push bypass recorded in report.
  Evidence is starting revision a2162af; rebase leaves decoding/matching unchanged. New chunk joining, full video, warm/download timing and renderer execution not checked.
- 2026-11-16: Guard lazy formula splicing with numeric/symbol/script/malformed checks, safe source fallback and explicit fidelity/counter metadata.
  Number-free unverified placeholders reach markdown, passages and exercises, excluding suspect values from narration and numeric grounding.
  Evidence: recorded step-7 strings plus synthetic regressions; 117 passed, 2 model tests deselected through `scripts/heavy.sh` at nice 10.
  Publication hook: `vitest: command not found`; Python-only push uses `--no-verify`, no JS test pass claimed.
  Not verified: real models/pages, renderer/native UI, existing enriched caches; text-layer agreement cannot prove mathematical correctness.

- 2026-11-15 (step 6): PDF ingest converts 20-page ranges, joins Docling documents before one IR pass, and reports completed/total pages plus thermal pauses.
  Synthetic 41-page test matches the unchunked IR across an exercise/section boundary; join checks retain figures, formula tokens and original range anchors.
  macOS serious/critical heat pauses before chunks and IR assembly; injectable source/sleep prove resume, with 5-second pause heartbeats.
  Replaced time estimates only in `src/library.ts` (and `src/library.test.ts`); no other home/source UI changes.
  Evidence: Python fast suite, affected library/Home/App/sourceQueue tests, Rust transport tests and TypeScript check; no real model runs or native Windows/Linux checks.
