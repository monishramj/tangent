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

## Log

(none yet; prepend dated entries here)
