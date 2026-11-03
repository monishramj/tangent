import json
import math
from pathlib import Path
import wave
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent
TEXTS = (ROOT.parent / "script.txt").read_text().splitlines()


def test_alignment_metrics():
    from spike import alignment_rows

    token = lambda start, end: SimpleNamespace(start=start, end=end)
    rows, metrics = alignment_rows(["big", "O", "n"],
                                   [[token(0, 2)], [], [token(3, 3)]], .1, 1)
    assert rows == [{"word": "big", "start": 0, "end": .2}]
    assert metrics["failed_words"] == ["O", "n"]
    assert not metrics["last_end_within_150ms"]
    _, metrics = alignment_rows(["big", "O"], [[token(2, 4)], [token(3, 10)]], .1, 1.1)
    assert not metrics["monotonic"]
    assert metrics["last_end_within_150ms"]


def test_results_contract():
    results = json.loads((ROOT / "out/results.json").read_text())
    assert "turbo" in results["model"].lower()
    assert results["device"] in {"mps", "mlx"}
    assert math.isfinite(results["load_sec"]) and results["load_sec"] > 0
    rows = results["per_sentence"]
    assert len(rows) == len(TEXTS) == 7
    for i, (row, text) in enumerate(zip(rows, TEXTS), 1):
        assert row["text"] == text
        with wave.open(str(ROOT / f"out/{i}.wav")) as wav:
            duration = wav.getnframes() / wav.getframerate()
            assert wav.getnchannels() == 1
        assert duration > 0
        assert row["audio_sec"] == pytest.approx(duration)
        assert math.isfinite(row["gen_sec"]) and row["gen_sec"] > 0
        assert row["rtf"] == pytest.approx(duration / row["gen_sec"])
    assert results["overall_rtf"] == pytest.approx(
        sum(r["audio_sec"] for r in rows) / sum(r["gen_sec"] for r in rows)
    )
    memory = results["peak_mem_gb_if_measurable"]
    assert memory is None or (math.isfinite(memory) and memory > 0)


@pytest.mark.parametrize("i,text", list(enumerate(TEXTS, 1)))
def test_alignment_contract(i, text):
    words = json.loads((ROOT / f"out/align_{i}.json").read_text())
    assert [w["word"] for w in words] == text.split()
    with wave.open(str(ROOT / f"out/{i}.wav")) as wav:
        duration = wav.getnframes() / wav.getframerate()
    previous = 0
    for word in words:
        assert set(word) == {"word", "start", "end"}
        assert math.isfinite(word["start"]) and math.isfinite(word["end"])
        assert previous <= word["start"] < word["end"] <= duration
        previous = word["end"]
    assert abs(duration - previous) <= 0.400  # relaxed from 0.150: Chatterbox pads 0.22-0.38s trailing silence
