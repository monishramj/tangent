import json, pathlib, numpy as np, soundfile as sf
O = pathlib.Path(__file__).parent / "out"
N = len(pathlib.Path(__file__).parent.parent.joinpath("script.txt").read_text().strip().splitlines())

def test_results():
    r = json.loads((O / "results.json").read_text())
    assert {"model", "voice", "load_sec", "per_sentence", "overall_rtf"} <= r.keys()
    assert len(r["per_sentence"]) == N
    assert all({"text", "audio_sec", "gen_sec", "rtf"} <= s.keys() for s in r["per_sentence"])

def test_align():
    for i in range(N):
        assert (O / f"s{i}.wav").exists()
        a = json.loads((O / f"align_{i}.json").read_text())
        x, sr = sf.read(O / f"s{i}.wav"); dur = np.nonzero(np.abs(x) > 0.01)[0][-1] / sr  # Kokoro pads ~0.5s trailing silence: compare to last voiced sample
        assert a and all(w["end"] > w["start"] for w in a)
        assert all(a[k]["start"] >= a[k - 1]["end"] - 1e-6 for k in range(1, len(a)))
        assert abs(a[-1]["end"] - dur) <= 0.15, (i, a[-1]["end"], dur)
