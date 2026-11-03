import json, pathlib
OUT = pathlib.Path(__file__).parent / "out"

def test_contract():
    r = json.loads((OUT / "results.json").read_text())
    assert {"tool", "version", "options", "inputs"} <= r.keys()
    assert r["inputs"]
    for i in r["inputs"]:
        assert {"file", "pages", "sec", "sec_per_page", "scores", "notes"} <= i.keys()
        assert set(i["scores"]) == {"latex", "figures", "sections", "exercises", "code_tables"}
        assert all(isinstance(v, int) and 0 <= v <= 5 for v in i["scores"].values())
        stem = pathlib.Path(i["file"]).stem
        assert (OUT / stem / f"{stem}.md").stat().st_size > 0
    assert (OUT / "REPORT.md").stat().st_size > 0
