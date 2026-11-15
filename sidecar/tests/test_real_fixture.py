import json

import pytest

from tangent_sidecar import handle, ingest
from tangent_sidecar.ingest import section_text
from tangent_sidecar.postprocess import postprocess

# Synthetic stand-in for a course IR that used to live in fixtures/. Same behaviours:
# junk glyphs, unnumbered headings under a dotted parent, "Solution" folded into the exercise.


def sec(id, title, level, md="", children=None, pages=(1,)):
    return {"id": id, "title": title, "level": level, "markdown": md, "figures": [],
            "exercises": [], "anchors": [{"page": p} for p in pages], "children": children or []}


RAW = {"sections": [
    sec("s-road", "Road  Map\ue000", 1, "intro \U0001f300", pages=(1,)),
    sec("s-52", "5.2. Topic", 2, "", pages=(1,), children=[
        sec("s-521", "5.2.1. First", 3, "one", pages=(1,)),
        sec("s-522", "5.2.2. Margin", 3, "", pages=(2,), children=[
            sec("s-a", "Marginal PMF", 1, "Marginal PMF\n\nalpha text", pages=(2,)),
            sec("s-b", "Deriving marginals", 1, "beta text", pages=(2,)),
            sec("s-c", "Law of partitions", 1, "gamma text", pages=(3,)),
            sec("s-d", "Example : toy calculation", 1, "delta text", pages=(3,)),
        ]),
        sec("s-523", "5.2.3. Independence", 3, "", pages=(4,), children=[
            sec("s-def", "Definition", 1, "defined here", pages=(4,)),
        ]),
        sec("s-524", "5.2.4. Next", 3, "n", pages=(5,)),
        sec("s-525", "5.2.5. After", 3, "a", pages=(6,)),
        sec("s-526", "5.2.6. Last", 3, "z", pages=(7,)),
        sec("s-ex", "Exercise 1", 1, "prompt", pages=(8,)),
        sec("s-sol", "Solution", 1, "worked steps", pages=(8,)),
    ]),
]}


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
        assert "\ue000" not in n["title"] + n["markdown"]
        assert "\U0001f300" not in n["title"] + n["markdown"]
        assert n["title"] == " ".join(n["title"].split())
    assert find(ir, "Road Map")["title"] == "Road Map"


def test_unnumbered_headings_nest_under_numbered(ir):
    marg = find(ir, "5.2.2.")
    kids = [c["title"] for c in marg["children"]]
    assert kids == ["Marginal PMF", "Deriving marginals", "Law of partitions", "Example : toy calculation"]
    indep = find(ir, "5.2.3.")
    assert [c["title"] for c in indep["children"]][0] == "Definition"
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
    monkeypatch.setattr(ingest, "pdf_info", lambda params: {"pages": 3})
    monkeypatch.setattr(ingest, "_join_documents", lambda docs, first: docs[0])
    monkeypatch.setattr(ingest, "document_to_ir", lambda doc, assets, *_: {"sections": []})
    monkeypatch.setattr(ingest, "_assets_root", lambda: tmp_path)
    ingest.ingest_pdf({"path": str(pdf), "pages": [2, 3]})
    assert seen == [(2, 3)]
    for bad in ([0, 1], [3, 2], [1], "1-2", [1.5, 2]):
        with pytest.raises(ValueError):
            ingest.ingest_pdf({"path": str(pdf), "pages": bad})
