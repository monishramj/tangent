# Sidecar JSON-lines RPC

Run with `uv run --project sidecar python -m tangent_sidecar`. Each stdin line is
one request; stdout contains exactly one JSON response per line. Diagnostics go
to stderr. Requests run serially in the long-lived process. Errors use
`{"id": <request id>, "error": "<message>"}`; the process keeps accepting requests.

- `ping {}` → `"pong"` (existing fixture: `ping.json`). No models loaded.
- `tts_align {"text": "Hello world.", "out_path": "/tmp/hello.wav", "voice": "af_heart"}`
  → `{"wav_path": "/tmp/hello.wav", "sec": 1.0, "words": [{"word": "Hello", "start": 0.02, "end": 0.4}, {"word": "world.", "start": 0.4, "end": 0.9}]}`
  (illustrative timings).

`text` and `out_path` are required nonempty strings; `voice` defaults to female
American English `af_heart`. Uses Kokoro-82M at 24 kHz, then torchaudio MMS_FA
against the known text at its native sample rate. Models load lazily once per
process; Kokoro uses MPS when available and MMS_FA uses CPU, as in the spike.
First use may download model weights; the English spaCy language package is a uv dependency.
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
