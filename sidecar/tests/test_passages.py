"""Textbook follow-along (docs/textbook-follow.md): passage ids + page bboxes in the IR."""
import pytest

from tangent_sidecar import ingest
from tangent_sidecar.postprocess import postprocess
from test_ingest import document, flatten  # noqa: F401  (pytest fixture)


def passages(ir):
    return [p for n in flatten(ir) for p in n.get("passages", [])]


def by_text(ir, text):
    hits = [p for p in passages(ir) if text in p["markdown"]]
    assert len(hits) == 1, (text, hits)
    return hits[0]


def test_every_section_has_passages_with_unique_document_order_ids(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    for node in flatten(ir):
        assert isinstance(node["passages"], list)
    ids = [p["id"] for p in passages(ir)]
    assert ids and len(ids) == len(set(ids))
    assert all(i.startswith("p") and i[1:].isdigit() for i in ids)
    assert [int(i[1:]) for i in ids] == sorted(int(i[1:]) for i in ids)
    # Stable across runs: cached bundles reference these ids.
    assert [p["id"] for p in passages(ingest.document_to_ir(document, tmp_path))] == ids


def test_passage_boxes_are_page_fractions_top_left(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    p = by_text(ir, "A second-page paragraph")
    # Fixture prov: page 2 of 600x800 pt, l=20 t=400 r=580 b=412 (top-left origin).
    assert len(p["boxes"]) == 1
    box = p["boxes"][0]
    assert box["page"] == 2
    assert box["bbox"] == pytest.approx([20 / 600, 400 / 800, 580 / 600, 412 / 800], abs=1e-4)
    for q in passages(ir):
        for b in q["boxes"]:
            x0, y0, x1, y1 = b["bbox"]
            assert 0 <= x0 <= x1 <= 1 and 0 <= y0 <= y1 <= 1 and b["page"] >= 1


def test_bottom_left_provenance_is_flipped(tmp_path):
    from docling_core.types.doc import BoundingBox, CoordOrigin, DoclingDocument, DocItemLabel, ProvenanceItem, Size
    doc = DoclingDocument(name="Flip")
    doc.add_page(page_no=1, size=Size(width=500, height=1000))
    doc.add_heading(text="Only", level=1)
    doc.add_text(label=DocItemLabel.TEXT, text="Low on the page", prov=ProvenanceItem(
        page_no=1, charspan=(0, 0), bbox=BoundingBox(l=50, t=200, r=450, b=100, coord_origin=CoordOrigin.BOTTOMLEFT)))
    p = by_text(ingest.document_to_ir(doc, tmp_path), "Low on the page")
    assert p["boxes"] == [{"page": 1, "bbox": pytest.approx([0.1, 0.8, 0.9, 0.9], abs=1e-4)}]


def test_passages_belong_to_the_section_whose_markdown_holds_them(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    for node in flatten(ir):
        for p in node["passages"]:
            assert p["markdown"] and p["markdown"] in node["markdown"]
        # Complete: the tagged script source built from passages loses no section text.
        assert "\n\n".join(p["markdown"] for p in node["passages"]) == node["markdown"]
    joint = next(n for n in flatten(ir) if n["title"] == "Joint distributions")
    assert any(p["markdown"].startswith("![") for p in joint["passages"])  # figures are passages too
    assert any(r"p_{X,Y}" in p["markdown"] for p in joint["passages"])


def test_stripped_margin_lines_get_no_passage(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    text = "\n".join(p["markdown"] for p in passages(ir))
    assert "Taylor Example" not in text
    assert text.count("Probability notes") <= 1


def test_postprocess_merges_cleans_and_keeps_passages():
    box = {"page": 1, "bbox": [0.1, 0.1, 0.9, 0.2]}
    ir = {"sections": [
        {"id": "s-a", "title": "5.1 Basics", "level": 1, "markdown": "e�cient", "figures": [], "exercises": [],
         "anchors": [{"page": 1}], "children": [],
         "passages": [{"id": "p1", "markdown": "e�cient", "boxes": [box]}]},
        # A promoted caption heading is merged into its host: its passages must move too.
        {"id": "s-b", "title": "Figure 2", "level": 2, "markdown": "after caption", "figures": [], "exercises": [],
         "anchors": [{"page": 2}], "children": [],
         "passages": [{"id": "p2", "markdown": "after caption", "boxes": [{"page": 2, "bbox": [0, 0, 1, 1]}]}]},
    ]}
    out = postprocess(ir)
    host = out["sections"][0]
    assert [p["id"] for p in host["passages"]] == ["p1", "p2"]
    assert host["passages"][0]["markdown"] == "efficient"  # same ligature fix as the section markdown
    assert host["passages"][0]["boxes"] == [box]


def test_old_ir_without_passages_still_postprocesses():
    ir = {"sections": [{"id": "s", "title": "Only", "level": 1, "markdown": "x", "figures": [], "exercises": [],
                        "anchors": [{"page": 1}], "children": []}]}
    assert postprocess(ir)["sections"][0]["markdown"] == "x"
