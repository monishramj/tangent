# Sidecar JSON-lines RPC

Run with `uv run --project sidecar python -m tangent_sidecar`. Each stdin line is
one request; stdout contains exactly one JSON response per line. Diagnostics go
to stderr. Requests run serially in the long-lived process. Errors use
`{"id": <request id>, "error": "<message>"}`; the process keeps accepting requests.

- `ping {}` → `"pong"` (existing fixture: `ping.json`). No models loaded.
- `tts_align {"text": "Hello world.", "out_path": "/tmp/hello.wav", "voice": "alba"}`
  → `{"wav_path": "/tmp/hello.wav", "sec": 1.0, "words": [{"word": "Hello", "start": 0.02, "end": 0.4}, {"word": "world.", "start": 0.4, "end": 0.9}]}`
  (illustrative timings).

`text` and `out_path` are required nonempty strings; `voice` defaults to
PocketTTS `alba`. Uses PocketTTS at 24 kHz, then torchaudio MMS_FA
against the known text at its native sample rate. Models load lazily once per
process; PocketTTS and MMS_FA use CPU. The selected voice state is cached too.
First use may download model weights and the preset voice embedding.
PocketTTS code is MIT; its public preset-model weights are [CC-BY-4.0](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning).
Torch/TorchAudio are pinned to the locally available spike versions with MMS_FA.

The output is mono PCM WAV. Paths are interpreted relative to the sidecar's
working directory; the parent directory must exist. An existing output file is
overwritten after successful synthesis/alignment. The caller must choose an
appropriate destination. The returned path matches the requested path.

Words keep the original whitespace-separated labels, including punctuation.
Alignment normalizes labels to lowercase ASCII letters and apostrophes and drops
labels that normalize to empty. At least one alignable word is required. Supply
English speech text with numbers/symbols already expanded into spoken words (as
in the spike); this endpoint does not perform math-to-speech conversion. Word
start/end times are seconds, rounded to milliseconds; `sec` is WAV duration.

Tests: `cd sidecar && uv run pytest` uses fake TTS/alignment models and excludes
`slow` by default. Opt in with `uv run pytest -m slow -s`; the single integration
test uses the first sentence of `spikes/tts/script.txt`, reports end-to-end
compute/audio RTF (including cold model load), and checks word count, bounds,
monotonic timestamps, and positive durations. No warm-up synthesis is performed.

## PDF ingestion

- `ingest_pdf {"path": "/absolute/path/chapter.pdf"}` →
  `{"sections": [{"id": "section-1", "title": "Joint distributions", "level": 1,
  "markdown": "Text and $$p_{X,Y}(x,y)$$", "figures": [{"id": "figure-1",
  "caption": "Joint probabilities", "image_path": "/absolute/path/figure-1.png"}],
  "exercises": [{"id": "section-1-exercise-1", "markdown": "1. Find the marginal.",
  "anchors": [{"page": 2}]}], "anchors": [{"page": 1}, {"page": 2}], "children": []}]}`
  (illustrative content).
- `list_sections {"ir": <ingest_pdf result>}` → a depth-first flat list of
  `{id, title, level, anchors}` for the section picker. An empty tree returns `[]`.

Paths must identify existing local PDFs; URLs and non-PDF files are rejected
before loading models. Relative paths use the sidecar working directory.
Docling loads lazily, enriches formulas, extracts figure PNGs, and serializes
Markdown including tables and available LaTeX. Partial conversions return an
RPC error rather than an incomplete IR. Diagnostics go to stderr.

Section levels follow Docling headings; text before the first heading becomes
a level-0 section named after the document. IDs are deterministic in document
order. Markdown belongs to each section; descendants are stored in `children`.
Page anchors are unique, sorted, **1-based**, and include descendants' pages.
Figure PNGs live in a unique directory under `sidecar/.ingest/`, with absolute
paths returned in the IR. Keep these files while using the IR; deleting that
directory invalidates saved image paths. Repeated ingestions create separate
asset directories and do not overwrite previous figures or the source PDF.

Noise filtering drops Docling furniture and detects repeated lines in the top
or bottom 15% of pages, normalizing whitespace, case, and changing numbers.
A line must occur on at least two distinct pages and at least half the pages.
Only margin occurrences are removed; matching text in the body is preserved.
There are no person-name or publisher-specific rules. Watermarks in the middle
of a page that Docling labels as body text are outside this heuristic.

Exercises are copied from explicitly titled English exercise/review/practice/
activity sections. Numbered items start new exercises; following content,
including formulas, stays with the preceding exercise. These are source
exercises, not generated questions. OCR is disabled as in the benchmark;
image-only PDFs and exercise conventions without explicit headings need
additional support.

The fast suite uses hand-made Docling items and never loads PDF models.
Run just the PDF integration (excluding the separate TTS integration) with:

```sh
taskpolicy -b env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
  VECLIB_MAXIMUM_THREADS=1 TOKENIZERS_PARALLELISM=false \
  uv run --project sidecar python -m pytest sidecar/tests/test_ingest.py -m slow -s
```

It parses `spikes/pdf/inputs/stat350_ch5_joint_pmfs.pdf` once, checks all 13 page
anchors and available LaTeX, verifies extracted figure paths, and reports wall
seconds, section count, LaTeX survival, and figure count. It writes `ir.json`
and `metrics.json` alongside figure files in pytest's temporary directory.
The converter limits model CPU threads to one; first use may download weights.

## Desktop pipeline bridge

`startSession({irSection, provider?, ttsAlign?, signal?})` in
`src/pipeline/session.ts` returns an async iterable with `next()`, `return()`,
`status()` and `bufferedAhead()`. The section's `markdown` runs through
`streamVideo`; defaults are Claude CLI and the `sidecarTts` adapter.

The adapter writes unique `tangent-<uuid>.wav` files directly in the OS temp
folder, then uses `convertFileSrc` for playback. Tauri must enable the
`protocol-asset` Cargo feature and `app.security.assetProtocol` with a scope of
`$TEMP/tangent-*.wav` (configured in this repo). Temp audio lasts until OS
cleanup; session-owned cleanup/persistent audio caching is deferred.

The Rust `sidecar_call` IPC accepts optional `timeoutMs` (default 300000).
The response timeout starts after the serialized request is sent, excluding
queue wait and process spawn. A timeout or transport error kills/resets the
connection so a subsequent request cannot receive a stale response. Blocking
work runs on Tauri's blocking pool. `ping` uses its own lazy sidecar process,
so long ingest/TTS calls do not block it; it checks that separate connection,
not whether the generation worker is idle. Work requests remain serial.
Aborting a session stops consumption promptly; an already dispatched IPC call
continues until completion/timeout and may leave a temp WAV.

`TANGENT_SIDECAR_DIR` overrides the uv project directory. Debug builds otherwise
use `CARGO_MANIFEST_DIR/../sidecar`. Release builds without an override return
an explicit error: bundled-sidecar resolution is a TODO until packaging lands.
