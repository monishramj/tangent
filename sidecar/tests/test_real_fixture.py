import json
import re
from pathlib import Path

import pytest

from tangent_sidecar import handle, ingest
from tangent_sidecar.ingest import section_text
from tangent_sidecar.postprocess import postprocess

RAW = json.loads((Path(__file__).parent / "fixtures" / "stat350_ch5_ir.json").read_text())
BAD = re.compile("[-\U0001f300-\U0001faff☀-➿️]")


def flat(nodes):
    for n in nodes:
        yield n
        yield from flat(n["children"])


def find(ir, prefix):
    return next(n for n in flat(ir["sections"]) if n["title"].startswith(prefix))


@pytest.fixture
def ir():
    return postprocess(json.loads(json.dumps(RAW)))


def test_glyphs_stripped(ir):
    for n in flat(ir["sections"]):
        assert not BAD.search(n["title"] + n["markdown"]), n["title"]
        assert n["title"] == " ".join(n["title"].split())
    assert find(ir, "Road Map")["title"] == "Road Map"


def test_unnumbered_headings_nest_under_numbered(ir):
    marg = find(ir, "5.2.2.")
    kids = [c["title"] for c in marg["children"]]
    assert kids == ["Marginal PMF", "Deriving Marginal PMFs from a Joint PMF",
                    "Marginal PMFs and the Law of Partitions",
                    "Example : Calculating marginal PMFs from a Joint PMF"]
    indep = find(ir, "5.2.3.")
    assert [c["title"] for c in indep["children"]][0] == "Definition"
    # numbered siblings stay siblings
    assert [c["title"][:5] for c in find(ir, "5.2. ")["children"] if c["title"][0].isdigit()] \
        == ["5.2.1", "5.2.2", "5.2.3", "5.2.4", "5.2.5", "5.2.6"]


def test_solution_folds_into_exercise(ir):
    titles = [n["title"] for n in flat(ir["sections"])]
    assert "Solution" not in titles
    ex = find(ir, "Exercise 1")
    assert "**Solution**" in ex["markdown"]


def test_section_text_includes_descendants(ir):
    marg = find(ir, "5.2.2.")
    text = section_text(ir, marg["id"])
    assert marg["markdown"] == ""
    assert text.index("Marginal PMF") >= 0
    assert all(c["markdown"] in text for c in marg["children"])
    assert text.index(marg["children"][0]["markdown"]) < text.index(marg["children"][1]["markdown"])
    with pytest.raises(ValueError):
        section_text(ir, "nope")


def test_section_text_rpc(ir):
    sid = find(ir, "5.2.2.")["id"]
    reply = handle({"id": 1, "method": "section_text", "params": {"ir": ir, "id": sid}})
    assert reply["result"] == section_text(ir, sid)


def test_pages_param(tmp_path, monkeypatch):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    seen = []
    monkeypatch.setattr(ingest, "_convert_pdf", lambda path, pages=None: seen.append(pages) or "doc")
    monkeypatch.setattr(ingest, "document_to_ir", lambda doc, assets: {"sections": []})
    monkeypatch.setattr(ingest, "_assets_root", lambda: tmp_path)
    ingest.ingest_pdf({"path": str(pdf), "pages": [2, 3]})
    assert seen == [(2, 3)]
    for bad in ([0, 1], [3, 2], [1], "1-2", [1.5, 2]):
        with pytest.raises(ValueError):
            ingest.ingest_pdf({"path": str(pdf), "pages": bad})
