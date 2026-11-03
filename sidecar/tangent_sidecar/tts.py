"""Kokoro synthesis and MMS_FA alignment, adapted from spikes/tts/kokoro/spike.py."""

import re
import sys
from contextlib import redirect_stdout
from functools import lru_cache


@lru_cache(maxsize=1)
def _load_tts():
    import torch
    from kokoro import KPipeline

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=device)
    pipe.model.to(device)
    return pipe


@lru_cache(maxsize=1)
def _load_aligner():
    import torchaudio

    bundle = torchaudio.pipelines.MMS_FA
    return bundle.get_model(), bundle.get_tokenizer(), bundle.get_aligner(), bundle.sample_rate


def tts_align(params):
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    for key in ("text", "out_path"):
        if not isinstance(params.get(key), str) or not params[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    voice = params.get("voice", "af_heart")
    if not isinstance(voice, str) or not voice.strip():
        raise ValueError("voice must be a non-empty string")
    words = params["text"].split()
    norm = [re.sub(r"[^a-z']", "", w.lower()) for w in words]
    keep = [(w, n) for w, n in zip(words, norm) if n]
    if not keep:
        raise ValueError("text must contain English words for alignment")

    # Model libraries print diagnostics; stdout belongs exclusively to JSON-lines RPC.
    with redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        import torch
        import torchaudio

        pipe = _load_tts()
        with torch.inference_mode():
            audio = np.concatenate([r.audio.cpu().numpy() for r in pipe(params["text"], voice=voice)])
        model, tokenizer, aligner, sample_rate = _load_aligner()
        wav = torchaudio.functional.resample(torch.from_numpy(audio)[None], 24000, sample_rate)
        with torch.inference_mode():
            emission, _ = model(wav)
        spans = aligner(emission[0], tokenizer([n for _, n in keep]))
        ratio = wav.shape[1] / emission.shape[1] / sample_rate
        aligned = [dict(word=w, start=round(sp[0].start * ratio, 3),
                        end=round(sp[-1].end * ratio, 3))
                   for (w, _), sp in zip(keep, spans, strict=True)]
        sf.write(params["out_path"], audio, 24000, format="WAV")
    return {"wav_path": params["out_path"], "sec": len(audio) / 24000, "words": aligned}
