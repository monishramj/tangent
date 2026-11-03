import sys, time, subprocess, pathlib, json, resource
inp, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
extra = sys.argv[3:]
out.mkdir(parents=True, exist_ok=True)
t = time.time()
p = subprocess.run(["uv", "run", "marker_single", str(inp), "--output_dir", str(out), *extra],
                   capture_output=True, text=True, stdin=subprocess.DEVNULL)
sec = time.time() - t
(out / f"{inp.stem}.log").write_text(p.stdout + p.stderr)
# children max RSS (bytes on macOS)
rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 2**20
print(json.dumps({"file": inp.name, "sec": round(sec, 1), "rc": p.returncode, "peak_rss_mb": round(rss)}))
