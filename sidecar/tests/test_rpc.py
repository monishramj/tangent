import json
import subprocess
from pathlib import Path

from tangent_sidecar import handle

ROOT = Path(__file__).resolve().parents[1]
FIX = json.loads((ROOT / "contract" / "ping.json").read_text())


def test_contract():
    assert handle(FIX["request"]) == FIX["response"]


def test_unknown_method():
    r = handle({"id": 2, "method": "nope", "params": {}})
    assert r["id"] == 2 and "nope" in r["error"]


def test_subprocess_roundtrip_survives_malformed():
    p = subprocess.run(
        ["uv", "run", "--project", str(ROOT), "python", "-m", "tangent_sidecar"],
        input="not json\n" + json.dumps(FIX["request"]) + "\n",
        capture_output=True, text=True, timeout=60, cwd=ROOT,
    )
    lines = [json.loads(l) for l in p.stdout.splitlines()]
    assert lines[0]["id"] is None and "error" in lines[0]
    assert lines[1] == FIX["response"]
