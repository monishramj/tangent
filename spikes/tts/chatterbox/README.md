# Chatterbox Turbo spike

**Blocked by sandbox network access.**

| Backend attempted | RTF (audio/wall) | Load | Peak memory |
|---|---:|---:|---:|
| Official Turbo / MPS | Unmeasured | Unmeasured | Unmeasured |
| mlx-audio (dependency lookup only) | Unmeasured | Unmeasured | Unmeasured |

Python 3.12.14 uv project created. Official installation failed resolving `github.com`; MLX lookup failed resolving `pypi.org`; `huggingface.co` also failed DNS. Local cache fixed uv's default cache permission failure. See `out/attempt_*.log`.

Tests first: eight artifact tests failed. Final: one unit test passes; eight artifact tests still fail. No fabricated measurements or timestamps.

Alignment sanity (monotonicity, 150 ms endpoint, positive durations) and failed words remain unmeasured. Runner uses MMS_FA on CPU separately from MPS timing; memory reports process peak RSS, excluding some Metal allocations. Load timing includes uncached downloads; generation includes first inference.

[Official output is PerTh-watermarked and supports paralinguistic tags](https://github.com/resemble-ai/chatterbox). Neither was experimentally verified.

[Published model repository size: 4.04 GB](https://huggingface.co/ResembleAI/chatterbox-turbo/tree/main); downloaded weights: zero. MMS_FA download size unverified.

Rerun: `sh spikes/tts/chatterbox/run.sh`.

Expected WAVs: `out/1.wav`, `out/2.wav`, `out/3.wav`, `out/4.wav`, `out/5.wav`, `out/6.wav`, `out/7.wav`. None exist. No Whisper transcription; pronunciation cannot be judged by ear. Audio quality needs human ears.
