import json, re, time, pathlib, numpy as np, soundfile as sf, torch, torchaudio
from kokoro import KPipeline
D = pathlib.Path(__file__).parent; O = D / "out"; O.mkdir(exist_ok=True)
lines = (D.parent / "script.txt").read_text().strip().splitlines()
dev = "mps" if torch.backends.mps.is_available() else "cpu"
t = time.time(); pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=dev); pipe.model.to(dev)
VOICES = ["af_heart", "am_michael"]
for v in VOICES: pipe.load_voice(v)
load = time.time() - t
def gen(text, v):
    t = time.time()
    a = np.concatenate([r.audio.cpu().numpy() for r in pipe(text, voice=v)])
    return a, time.time() - t
gen("Warm up.", VOICES[0])  # exclude first-run kernel compile
for vi, v in enumerate(VOICES):
    od = O if vi == 0 else O / v; od.mkdir(exist_ok=True)
    per = []
    for i, s in enumerate(lines):
        a, g = gen(s, v); sf.write(od / f"s{i}.wav", a, 24000)
        per.append(dict(text=s, audio_sec=len(a) / 24000, gen_sec=g, rtf=len(a) / 24000 / g))
    res = dict(model="Kokoro-82M", device=dev, voice=v, load_sec=load, per_sentence=per,
               overall_rtf=sum(p["audio_sec"] for p in per) / sum(p["gen_sec"] for p in per))
    (od / "results.json").write_text(json.dumps(res, indent=1)); print(v, load, res["overall_rtf"])

# forced alignment (MMS_FA), primary voice
bundle = torchaudio.pipelines.MMS_FA; m = bundle.get_model(); tok = bundle.get_tokenizer(); al = bundle.get_aligner()
for i, s in enumerate(lines):
    x, sr = sf.read(O / f"s{i}.wav", dtype="float32"); wav = torch.from_numpy(x)[None];  wav = torchaudio.functional.resample(wav, sr, bundle.sample_rate)
    words = s.split(); norm = [re.sub(r"[^a-z']", "", w.lower()) for w in words]
    keep = [(w, n) for w, n in zip(words, norm) if n]
    with torch.inference_mode(): em, _ = m(wav)
    spans = al(em[0], tok([n for _, n in keep]))
    ratio = wav.shape[1] / em.shape[1] / bundle.sample_rate
    out = [dict(word=w, start=round(sp[0].start * ratio, 3), end=round(sp[-1].end * ratio, 3)) for (w, _), sp in zip(keep, spans)]
    (O / f"align_{i}.json").write_text(json.dumps(out, indent=1))
    print(i, "dropped:", [w for w in words if not re.sub(r"[^a-z']", "", w.lower())], "last_end", out[-1]["end"], "dur", round(wav.shape[1] / bundle.sample_rate, 3))

# whisper transcript check
import whisper
w = whisper.load_model("base.en")
for i in range(len(lines)): print(i, "WHISPER:", w.transcribe(str(O / f"s{i}.wav"), language="en")["text"].strip())
