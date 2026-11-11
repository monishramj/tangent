# VoiceStudio narration evaluation

Recommendation: **keep Kokoro `af_heart` as the default for now**. VoiceStudio is an application and adapter collection, rather than a new narration model. Its strongest practical alternative here is PocketTTS Alba: faster than our baseline without occupying the GPU. Qwen3 and Chatterbox now beat real time through MLX on this machine, but leave substantially less room for alignment and other scene work. These samples support a listening comparison; no subjective listening test was performed, so there is no evidence yet that either voice sounds better to the user.

## Samples and measured results

Host: Apple M4 Max, 14 CPU cores, 36 GB unified RAM. All files contain the exact three requested texts, separately synthesized in the requested order, with exactly 0.5 seconds of inserted PCM silence between texts. MP4s are audio-only AAC, 192 kb/s, mono, 24 kHz. Default speed and model sampling settings were used.

RTF = total synthesis wall time / generated speech duration, excluding the inserted silence. Lower is faster. Model/package loading, downloads, AAC encoding and MMS_FA alignment are excluded; first-generation kernel/setup costs are included. This is one three-text run per voice, not a statistically stable throughput benchmark. GPU runs were sequential.

| Voice / model | Device | Generation / speech seconds | RTF | License | Notes |
|---|---|---:|---:|---|---|
| Kokoro-82M `af_heart` | PyTorch MPS | 3.280 / 24.250 | **0.135** | Apache-2.0 | Current baseline; about 7.4× real time |
| PocketTTS 2.1.0 `alba` | CPU | 2.065 / 21.120 | **0.098** | MIT code; CC-BY-4.0 weights | About 10.2× real time; SDK automatically used the public without-voice-cloning weights and preset embedding, without an HF login |
| Qwen3-TTS 1.7B VoiceDesign 4-bit, warm narrator | MLX / Metal | 13.111 / 26.000 | **0.504** | Apache-2.0 | About 2.0× real time; independently designs each text's voice from the same description |
| Chatterbox TTS 4-bit, Alba clone | MLX / Metal | 15.454 / 23.880 | **0.647** | Upstream MIT; conversion card does not separately declare a license | About 1.5× real time; uses the first 7.2 seconds of the generated PocketTTS sample as reference; this is original Chatterbox, not Chatterbox Turbo |

Absolute MP4 paths:

- `/Users/monishramj/Documents/Code/orca/workspaces/tangent/voice-samples/voice-samples/kokoro-af_heart.mp4`
- `/Users/monishramj/Documents/Code/orca/workspaces/tangent/voice-samples/voice-samples/voicestudio-pockettts-alba.mp4`
- `/Users/monishramj/Documents/Code/orca/workspaces/tangent/voice-samples/voice-samples/voicestudio-qwen3-warm-narrator.mp4`
- `/Users/monishramj/Documents/Code/orca/workspaces/tangent/voice-samples/voice-samples/voicestudio-chatterbox-alba-clone.mp4`

Each has a sibling JSON file with exact measurements and per-text timings. File durations including the gaps are 25.25, 22.12, 27.00 and 24.88 seconds respectively. Qwen's first text took 7.862 seconds versus 2.766 and 2.483 for subsequent texts; Chatterbox took 7.850, 3.507 and 4.097. Model load/setup wall times were 9.394, 18.509, 3.425 and 1.806 seconds in table order; they include import/download work where applicable and are not comparable cold-start benchmarks.

Qwen description: `A warm, clear female American narrator, calm and engaging, explaining a computer science lesson at a natural pace.`

## What VoiceStudio wraps

Inspected shallow clone: `/private/tmp/voicestudio-eval.XOecJ3/repo`, commit `c85a866f19dfddd6a31c50f88ee2e08e644c77ea` (evaluated 2026-11-10). Read source and configuration first; did not run the repository's installers, setup scripts, app, or server. Benchmarks directly invoke the underlying SDKs used by its adapters.

The registry includes OmniVoice (also subprocess and native GGUF), VoxCPM2, MOSS-TTS-Nano, MOSS-TTS v1.5, KittenTTS, CosyVoice (also GGUF), GPT-SoVITS, IndexTTS 2/2.5, PocketTTS, Supertonic-3, dots.tts, Confucius4, Ming, audio.cpp Breeze/dots and sherpa-onnx. Its MLX adapter curates Kokoro, CSM, Qwen3 Base/VoiceDesign, Dia, Chatterbox, MeloTTS, OuteTTS and VoxCPM2; the installed MLX library can support additional models. These are alternatives with different licenses and hardware requirements, not one VoiceStudio voice model. [Registry source](https://github.com/debpalash/VoiceStudio/blob/c85a866f19dfddd6a31c50f88ee2e08e644c77ea/backend/services/tts_backend.py).

Apple support: the app supports Apple Silicon; its default OmniVoice uses PyTorch MPS or CPU, while the MLX adapter uses Apple's Metal GPU through MLX (not PyTorch MPS). PocketTTS deliberately uses CPU. Some other opt-in engines are CUDA-only or CPU fallbacks and are not attractive default choices here. The candidate runs above actually completed on this machine.

Application code is **AGPL-3.0-only**, with optional paid proprietary licensing. Free use under AGPL is available. Underlying SDKs and weights retain their own licenses; embedding the whole application is unnecessary for our sidecar. In particular, default OmniVoice code is Apache-2.0 but its weights are **CC-BY-NC**, with additional Higgs/Llama tokenizer terms, so it fails a strict open-source/commercially reusable weights requirement. It was excluded rather than downloaded or benchmarked. [Application license notice](https://github.com/debpalash/VoiceStudio/blob/main/LICENSE-NOTICE.md), [OmniVoice model terms](https://huggingface.co/k2-fsa/OmniVoice).

## Headless calls

No GUI or paid service is required. Our benchmark script is `/private/tmp/voicestudio-eval.XOecJ3/benchmark.py`.

```python
# Current baseline, through the existing sidecar venv:
from kokoro import KPipeline
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="mps")
chunks = [r.audio for r in pipe(text, voice="af_heart")]

# PocketTTS, CPU:
from pocket_tts import TTSModel
model = TTSModel.load_model()
state = model.get_state_for_audio_prompt("alba")
audio = model.generate_audio(state, text)

# VoiceStudio's curated MLX candidates:
from mlx_audio.tts.utils import load_model
model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit")
results = model.generate(text=text, lang_code="english", instruct=description)
# Each result has .audio and .sample_rate.
model = load_model("mlx-community/Chatterbox-TTS-4bit")
results = model.generate(text=text, ref_audio="alba-reference.wav")
```

VoiceStudio also exposes a headless OpenAI-compatible `POST /v1/audio/speech` endpoint, with `model`, `input`, `voice`, `instructions` and `response_format`. MLX selection uses `OMNIVOICE_TTS_BACKEND=mlx-audio` and `OMNIVOICE_MLX_AUDIO_MODEL=<model repo or curated key>`. For default OmniVoice there is `omnivoice-infer --text '...' --instruct '...' --output out.wav --device mps`. Neither the application server nor this CLI was needed for the measurements. [MLX adapter documentation](https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/mlx-audio.md).

## Installation footprint and reproducibility

No global packages installed; candidate SDKs are in `/private/tmp/voicestudio-eval.XOecJ3/venv` (about **1.1 GiB**, shared dependencies). Versions: Python 3.12.14, PyTorch 2.15.0, mlx-audio 0.6.5, MLX 0.32.4, PocketTTS **2.1.0**, matching VoiceStudio's PocketTTS pin. `HF_HOME=/private/tmp/voicestudio-eval.XOecJ3/hf` was set only on evaluation commands. The worktree had no sidecar venv, so the baseline used the existing sibling sidecar venv via `UV_PROJECT_ENVIRONMENT=/Users/monishramj/Documents/Code/orca/workspaces/tangent/audio-issue/sidecar/.venv` and `cd sidecar && uv run --no-sync python ...`; it was not synchronized or modified.

Actual selected checkpoint file sizes (decimal bytes, summing snapshot files including symlink targets):

| Model assets | Downloaded size | Snapshot revision |
|---|---:|---|
| Kokoro baseline plus selected voice/config | 327,738,002 B (~328 MB) | `f3ff3571791e39611d31c381e3a41a3af07b4987` |
| PocketTTS public English + Alba embedding | 225,282,959 B (~225 MB) | weights `d29db7978e464fb90cb3359ee0c69a273b9142cc`; embedding `e041936c75475d350b405bc870bcf7c22da4e9e6` |
| Chatterbox 4-bit | 1,023,414,174 B (~1.02 GB) | `a3c8ded2d711d6395410d645b3a97c79fd563a13` |
| Chatterbox's additional S3TokenizerV2 | 494,869,110 B (~495 MB) | `e0c9886f0e1c35ae85b1f27277416fb19fc72bec` |
| Qwen3 VoiceDesign 4-bit, including speech tokenizer | 2,312,058,795 B (~2.31 GB) | `5c390979e4b93af5f2932f90742ca99c7dd04687` |

These sizes are more useful than VoiceStudio's catalog estimates (e.g. it lists Chatterbox at 0.5 GiB and Qwen at 1.4 GiB). Default OmniVoice is catalogued at 2.4 GiB, not measured here. Full VoiceStudio installation size was not measured; it installs a much broader ASR/dubbing/UI stack than needed for narration. [Catalog](https://github.com/debpalash/VoiceStudio/blob/main/backend/config/models.yaml), [PocketTTS public weights](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), [Qwen checkpoint](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit).

## Errors, integration and limits

Chatterbox without a reference failed exactly with: `ValueError: No conditionals available. Either provide audio_prompt/audio_prompt_sr for voice cloning, or ensure conds.safetensors is in the model directory.` The downloaded curated checkpoint does not contain `conds.safetensors`; supplying the generated Alba reference resolved it. Its conversion card points to mlx-audio-plus, although mlx-audio 0.6.5 successfully ran it. [Conversion card](https://huggingface.co/mlx-community/Chatterbox-TTS-4bit), [upstream license](https://huggingface.co/ResembleAI/chatterbox).

Qwen emitted a Transformers model-type warning during loading but generated all three clips successfully. No model crash or unsupported-MPS error occurred in completed candidate runs. Sandboxed PyTorch initially reported MPS unavailable; the authorized GPU benchmarks ran outside that sandbox and the baseline recorded `mps`.

MMS_FA means no candidate needs native word timestamps. Keep synthesizing each narration segment independently, force-align its PCM waveform against the exact normalized text, then offset word times using the segment's actual sample span. Our existing `tts.py` assumes 24 kHz when joining and resampling, so a provider integration must preserve the actual sample rate or normalize to 24 kHz before that code. All tested outputs already use 24 kHz. Use lossless PCM for alignment; AAC MP4 is the comparison delivery format. Generation RTF here does **not** include forced alignment, so it does not by itself prove the scene-buffer invariant.

No tracked repository files changed. Skipped a listening-quality judgment, MMS_FA accuracy/end-to-end timing, full-app installation, and exhaustive model benchmarking. Remaining risks are subjective quality, independently designed Qwen voice consistency across segments, Chatterbox's reference requirement/conversion-license gap, and single-run timing variance.
