import json, pathlib
OUT = pathlib.Path(__file__).parent / "out"
SC = {"latex", "figures", "sections", "exercises", "code_tables"}

def test_contract():
    r = json.loads((OUT / "results.json").read_text())
    assert r["tool"] == "marker" and r["version"] and r["options"] is not None
    assert r["inputs"]
    for i in r["inputs"]:
        assert {"file", "pages", "sec", "sec_per_page", "scores", "notes"} <= i.keys()
        assert set(i["scores"]) == SC
        assert all(isinstance(v, int) and 0 <= v <= 5 for v in i["scores"].values())
        stem = pathlib.Path(i["file"]).stem
        assert list((OUT / stem).rglob("*.md")), stem
    assert (OUT / "REPORT.md").stat().st_size > 0
