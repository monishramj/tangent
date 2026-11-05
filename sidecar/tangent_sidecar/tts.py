"""Kokoro synthesis and MMS_FA alignment, adapted from spikes/tts/kokoro/spike.py.

`tts_align` synthesizes each segment (one narration beat) separately, joins them with
`gap_sec` of silence, and aligns every segment against its own slice of audio. Each beat
then has a real pause after it, and the client can cut beats at the returned segment
boundaries instead of by counting words.
"""

import re
import sys
from contextlib import redirect_stdout
from functools import lru_cache

SAMPLE_RATE = 24000
DEFAULT_GAP_SEC = 0.45
MAX_GAP_SEC = 5.0


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


def alignable(text):
    """(original word, aligner token) pairs. The aligner only knows [a-z']; other tokens drop out."""
    words = text.split()
    pairs = [(w, re.sub(r"[^a-z']", "", w.lower())) for w in words]
    return [(w, n) for w, n in pairs if n]


def layout_segments(lengths, gap_samples):
    """Sample spans for segments laid end to end with `gap_samples` of silence between them
    (none after the last). Returns ([(start, end), ...], total_samples)."""
    spans, at = [], 0
    for i, n in enumerate(lengths):
        if i:
            at += gap_samples
        spans.append((at, at + n))
        at += n
    return spans, at


def merge_alignments(per_segment, spans, sample_rate=SAMPLE_RATE):
    """Shift each segment's local word times by its start; returns (words, segments) in seconds."""
    words, segments = [], []
    for seg_words, (start, end) in zip(per_segment, spans, strict=True):
        offset = start / sample_rate
        segments.append({"start": round(offset, 3), "end": round(end / sample_rate, 3)})
        words.extend({"word": w["word"], "start": round(w["start"] + offset, 3),
                      "end": round(w["end"] + offset, 3)} for w in seg_words)
    return words, segments


def _params(params):
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    if not isinstance(params.get("out_path"), str) or not params["out_path"].strip():
        raise ValueError("out_path must be a non-empty string")
    segments = params.get("segments")
    if segments is None:  # back-compat: one segment
        if not isinstance(params.get("text"), str) or not params["text"].strip():
            raise ValueError("text must be a non-empty string")
        segments = [params["text"]]
    if not isinstance(segments, list) or not segments:
        raise ValueError("segments must be a non-empty list of strings")
    for i, seg in enumerate(segments):
        if not isinstance(seg, str) or not seg.strip():
            raise ValueError(f"segment {i} must be a non-empty string")
        if not alignable(seg):
            raise ValueError(f"segment {i} must contain English words for alignment")
    voice = params.get("voice", "af_heart")
    if not isinstance(voice, str) or not voice.strip():
        raise ValueError("voice must be a non-empty string")
    gap = params.get("gap_sec", DEFAULT_GAP_SEC)
    if isinstance(gap, bool) or not isinstance(gap, (int, float)) or not 0 <= gap <= MAX_GAP_SEC:
        raise ValueError(f"gap_sec must be a number between 0 and {MAX_GAP_SEC}")
    return segments, voice, float(gap)


def tts_align(params):
    segments, voice, gap_sec = _params(params)

    # Model libraries print diagnostics; stdout belongs exclusively to JSON-lines RPC.
    with redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        import torch
        import torchaudio

        pipe = _load_tts()
        model, tokenizer, aligner, align_rate = _load_aligner()
        clips, per_segment = [], []
        for text in segments:
            with torch.inference_mode():
                audio = np.concatenate([r.audio.cpu().numpy() for r in pipe(text, voice=voice)])
            keep = alignable(text)
            wav = torchaudio.functional.resample(torch.from_numpy(audio)[None], SAMPLE_RATE, align_rate)
            with torch.inference_mode():
                emission, _ = model(wav)
            spans = aligner(emission[0], tokenizer([n for _, n in keep]))
            ratio = wav.shape[1] / emission.shape[1] / align_rate
            per_segment.append([dict(word=w, start=sp[0].start * ratio, end=sp[-1].end * ratio)
                                for (w, _), sp in zip(keep, spans, strict=True)])
            clips.append(audio.astype(np.float32))

        layout, total = layout_segments([len(c) for c in clips], round(gap_sec * SAMPLE_RATE))
        out = np.zeros(total, dtype=np.float32)
        for clip, (start, end) in zip(clips, layout):
            out[start:end] = clip
        words, segs = merge_alignments(per_segment, layout)
        sf.write(params["out_path"], out, SAMPLE_RATE, format="WAV")
    return {"wav_path": params["out_path"], "sec": total / SAMPLE_RATE, "words": words, "segments": segs}
