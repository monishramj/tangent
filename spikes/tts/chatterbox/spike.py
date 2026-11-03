"""Run from this directory with `sh run.sh`; RTF means audio_sec / gen_sec."""
import gc
import json
import os
from pathlib import Path
import re
import resource
import time

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
for key, directory in (("HF_HOME", "huggingface"), ("TORCH_HOME", "torch"),
                       ("XDG_CACHE_HOME", "")):
    os.environ[key] = str(ROOT / ".cache" / directory)


def alignment_rows(words, spans, seconds_per_frame, audio_sec):
    assert len(words) == len(spans)
    rows, failed = [], []
    for word, tokens in zip(words, spans):
        if not tokens or tokens[-1].end <= tokens[0].start:
            failed.append(word)
            continue
        rows.append({"word": word, "start": tokens[0].start * seconds_per_frame,
                     "end": tokens[-1].end * seconds_per_frame})
    return rows, {
        "failed_words": failed,
        "monotonic": all(a["end"] <= b["start"] for a, b in zip(rows, rows[1:])),
        "no_zero_length_words": all(w["start"] < w["end"] for w in rows),
        "within_audio": all(0 <= w["start"] < w["end"] <= audio_sec for w in rows),
        "last_word_end_gap_sec": audio_sec - rows[-1]["end"] if rows else None,
        "last_end_within_150ms": bool(rows) and abs(audio_sec - rows[-1]["end"]) <= .15,
    }


def main():
    import soundfile as sf
    import torch
    import torchaudio
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    texts = (ROOT.parent / "script.txt").read_text().splitlines()
    assert len(texts) == 7 and all(texts)
    assert torch.backends.mps.is_available(), "MPS unavailable; refusing a CPU benchmark"
    torch.manual_seed(0)
    start = time.perf_counter()
    model = ChatterboxTurboTTS.from_pretrained(device="mps")
    torch.mps.synchronize()
    load_sec = time.perf_counter() - start
    results = {"model": "ResembleAI/chatterbox-turbo", "device": "mps",
               "load_sec": load_sec, "per_sentence": [], "overall_rtf": None,
               "peak_mem_gb_if_measurable": None}
    with torch.inference_mode():  # warm-up, excluded from timings
        model.generate("Warm up call.")
    torch.mps.synchronize()
    for i, text in enumerate(texts, 1):
        torch.mps.synchronize()
        start = time.perf_counter()
        with torch.inference_mode():
            wav = model.generate(text)
        torch.mps.synchronize()
        gen_sec = time.perf_counter() - start
        wav = wav.detach().cpu().reshape(-1).numpy()
        sf.write(OUT / f"{i}.wav", wav, model.sr, subtype="PCM_16")
        audio_sec = len(wav) / model.sr
        results["per_sentence"].append({"text": text, "audio_sec": audio_sec,
                                       "gen_sec": gen_sec, "rtf": audio_sec / gen_sec})
        print(i, results["per_sentence"][-1], flush=True)
    results["overall_rtf"] = (sum(r["audio_sec"] for r in results["per_sentence"]) /
                              sum(r["gen_sec"] for r in results["per_sentence"]))
    # macOS ru_maxrss is bytes; process RSS excludes some shared/Metal allocations.
    results["peak_mem_gb_if_measurable"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    del model
    gc.collect()
    torch.mps.empty_cache()

    # MMS alignment runs on CPU, outside the TTS timing and memory measurement.
    bundle = torchaudio.pipelines.MMS_FA
    start = time.perf_counter()
    align_model = bundle.get_model().eval()
    tokenizer, aligner = bundle.get_tokenizer(), bundle.get_aligner()
    sanity = {"device": "cpu", "load_sec": time.perf_counter() - start, "per_sentence": []}
    for i, text in enumerate(texts, 1):
        words = text.split()
        normalized = [re.sub("[^a-z']", "", w.lower()) for w in words]
        assert all(normalized), "Input contains a word MMS_FA cannot tokenize"
        wav, sr = sf.read(OUT / f"{i}.wav", dtype="float32")
        audio_sec = len(wav) / sr
        waveform = torchaudio.functional.resample(torch.from_numpy(wav)[None], sr, bundle.sample_rate)
        with torch.inference_mode():
            emission, _ = align_model(waveform)
            spans = aligner(emission[0], tokenizer(normalized))
        rows, metrics = alignment_rows(words, spans, audio_sec / emission.shape[1], audio_sec)
        (OUT / f"align_{i}.json").write_text(json.dumps(rows, indent=2))
        sanity["per_sentence"].append({"sentence": i, **metrics})
        (OUT / "alignment_sanity.json").write_text(json.dumps(sanity, indent=2))
    (OUT / "failure.json").unlink(missing_ok=True)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    try:
        main()
    except Exception as error:
        (OUT / "failure.json").write_text(json.dumps({"error": repr(error)}, indent=2))
        raise
