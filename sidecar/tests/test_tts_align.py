import json
import sys
import time
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from tangent_sidecar import handle, main


@pytest.fixture
def models(monkeypatch):
    import torch
    from tangent_sidecar import tts

    calls = {"tts_load": 0, "align_load": 0, "voices": [], "texts": []}

    class TTSModel:
        sample_rate = 24000

        @classmethod
        def load_model(cls):
            calls["tts_load"] += 1
            return cls()

        def get_state_for_audio_prompt(self, voice):
            calls["voices"].append(voice)
            return voice

        def generate_audio(self, state, text):
            assert not torch.is_inference_mode_enabled()
            print("model diagnostic")
            assert state in ("alba", "vera")
            calls["texts"].append(text)
            return torch.zeros(24000)

    def get_model():
        calls["align_load"] += 1
        return lambda wav: (torch.zeros((1, 50, 2)), None)

    def align(emission, tokens):
        calls.setdefault("tokens", []).append(tokens)
        return [[SimpleNamespace(start=1 + 12 * i, end=10 + 12 * i + (8 if i else 0))] for i in range(len(tokens))]

    import torchaudio
    monkeypatch.setitem(sys.modules, "pocket_tts", SimpleNamespace(TTSModel=TTSModel))
    monkeypatch.setattr(torchaudio.pipelines, "MMS_FA", SimpleNamespace(
        sample_rate=16000, get_model=get_model,
        get_tokenizer=lambda: lambda words: words, get_aligner=lambda: align,
    ))
    tts._load_tts.cache_clear()
    tts._load_voice.cache_clear()
    tts._load_aligner.cache_clear()
    yield calls
    tts._load_tts.cache_clear()
    tts._load_voice.cache_clear()
    tts._load_aligner.cache_clear()


def test_rpc_wav_alignment_and_warm_models(models, tmp_path):
    paths = [tmp_path / "first.wav", tmp_path / "second.wav", tmp_path / "third.wav"]
    for i, path in enumerate(paths):
        params = {"text": "Hello, !!! world!", "out_path": str(path)}
        if i == 2:
            params["voice"] = "vera"
        result = handle({"id": i, "method": "tts_align", "params": params})
        assert result == {"id": i, "result": {
            "wav_path": str(path), "sec": 1.0,
            "words": [{"word": "Hello,", "start": 0.02, "end": 0.2},
                      {"word": "world!", "start": 0.26, "end": 0.6}],
            "segments": [{"start": 0.0, "end": 1.0}],
        }}
        with wave.open(str(path)) as wav:
            assert (wav.getframerate(), wav.getnframes(), wav.getnchannels()) == (24000, 24000, 1)
    assert models["tts_load"] == models["align_load"] == 1
    assert models["voices"] == ["alba", "vera"]
    assert models["texts"] == ["Hello, !!! world!"] * 3
    assert models["tokens"] == [["hello", "world"]] * 3


def test_segments_get_gaps_and_offset_alignment(models, tmp_path):
    path = tmp_path / "beats.wav"
    result = handle({"id": 1, "method": "tts_align", "params": {
        "segments": ["Hello world.", "Again, 42 times."], "out_path": str(path), "gap_sec": 0.5}})["result"]
    # Each fake segment is 1 s of audio; 0.5 s of silence between them, none after the last.
    assert result["sec"] == 2.5
    assert result["segments"] == [{"start": 0.0, "end": 1.0}, {"start": 1.5, "end": 2.5}]
    assert [w["word"] for w in result["words"]] == ["Hello", "world.", "Again,", "times."]
    assert [w["start"] for w in result["words"]] == [0.02, 0.26, 1.52, 1.76]
    assert models["texts"] == ["Hello world.", "Again, 42 times."]
    assert models["tokens"] == [["hello", "world"], ["again", "times"]]
    with wave.open(str(path)) as wav:
        assert wav.getnframes() == 60000


def test_default_gap(models, tmp_path):
    result = handle({"id": 1, "method": "tts_align", "params": {
        "segments": ["Hello world.", "Hello world."], "out_path": str(tmp_path / "x.wav")}})["result"]
    assert result["segments"][1]["start"] == 1.45


def test_unexpected_sample_rate_is_rejected(models, monkeypatch, tmp_path):
    monkeypatch.setattr(sys.modules["pocket_tts"].TTSModel, "sample_rate", 22050)
    path = tmp_path / "wrong-rate.wav"
    reply = handle({"id": 1, "method": "tts_align", "params": {
        "text": "Hello world.", "out_path": str(path)}})
    assert "Expected 24000 Hz TTS audio, got 22050" in reply["error"]
    assert models["align_load"] == 0
    assert not path.exists()


@pytest.mark.parametrize("params", [
    {}, {"text": "", "out_path": "x.wav"},
    {"text": 42, "out_path": "x.wav"}, {"text": "123 !!!", "out_path": "x.wav"},
    {"text": "hello", "out_path": ""}, {"text": "hello", "out_path": 42},
    {"text": "hello", "out_path": "x.wav", "voice": None},
    {"text": "hello", "out_path": "x.wav", "voice": ""}, None,
    {"segments": [], "out_path": "x.wav"}, {"segments": "hello", "out_path": "x.wav"},
    {"segments": ["hello", ""], "out_path": "x.wav"}, {"segments": ["hello", "123"], "out_path": "x.wav"},
    {"segments": ["hello"], "out_path": "x.wav", "gap_sec": -1},
    {"segments": ["hello"], "out_path": "x.wav", "gap_sec": "0.4"},
    {"segments": ["hello"], "out_path": "x.wav", "gap_sec": True},
    {"segments": ["hello"], "out_path": "x.wav", "gap_sec": 99},
])
def test_invalid_params_do_not_load_models(monkeypatch, params):
    from tangent_sidecar import tts
    monkeypatch.setattr(tts, "_load_tts", lambda: pytest.fail("loaded models for invalid params"))
    result = handle({"id": 8, "method": "tts_align", "params": params})
    assert result["id"] == 8 and "error" in result


def test_json_lines_keeps_stdout_clean_and_recovers(models, tmp_path, monkeypatch, capsys):
    requests = [
        {"id": 1, "method": "tts_align", "params": {"text": "Hello world", "out_path": str(tmp_path / "missing" / "x.wav")}},
        {"id": 2, "method": "tts_align", "params": {"text": "Hello world", "out_path": str(tmp_path / "ok.wav")}},
        {"id": 3, "method": "ping", "params": {}},
    ]
    import io
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))
    main()
    captured = capsys.readouterr()
    replies = [json.loads(line) for line in captured.out.splitlines()]
    assert "error" in replies[0]
    assert replies[1]["result"]["sec"] == 1
    assert replies[2] == {"id": 3, "result": "pong"}
    assert "model diagnostic" in captured.err


@pytest.mark.slow
def test_real_tts_align(tmp_path):
    text = (Path(__file__).resolve().parents[2] / "spikes/tts/script.txt").read_text().splitlines()[0]
    started = time.perf_counter()
    reply = handle({"id": 1, "method": "tts_align", "params": {
        "text": text, "out_path": str(tmp_path / "real.wav"),
    }})
    elapsed = time.perf_counter() - started
    assert "error" not in reply, reply
    result = reply["result"]
    words = result["words"]
    assert [w["word"] for w in words] == text.split()
    assert all(0 <= w["start"] < w["end"] <= result["sec"] for w in words)
    assert all(a["end"] <= b["start"] for a, b in zip(words, words[1:]))
    print(json.dumps({"audio_sec": result["sec"], "elapsed_sec": elapsed,
                      "rtf_compute_over_audio": elapsed / result["sec"],
                      "realtime_speed": result["sec"] / elapsed,
                      "words": words, "monotonic": True, "positive_durations": True}))
