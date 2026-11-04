import io
import json
import re
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from tangent_sidecar import handle, main
from tangent_sidecar import ingest


@pytest.fixture
def document():
    """Tiny hand-made Docling document; no converter or models involved."""
    from docling_core.types.doc import (
        BoundingBox, CoordOrigin, DoclingDocument, DocItemLabel,
        ImageRef, ProvenanceItem, Size,
    )
    from PIL import Image

    doc = DoclingDocument(name="Probability")
    for page in range(1, 4):
        doc.add_page(page_no=page, size=Size(width=600, height=800))

    def prov(page, y=400):
        return ProvenanceItem(page_no=page, charspan=(0, 0), bbox=BoundingBox(
            l=20, t=y, r=580, b=y + 12, coord_origin=CoordOrigin.TOPLEFT,
        ))

    def text(value, page, y=400, label=DocItemLabel.TEXT):
        return doc.add_text(label=label, text=value, prov=prov(page, y))

    text("Opening paragraph", 1)
    doc.add_heading(text="Joint distributions", level=1, prov=prov(1))
    text("A useful repeated definition", 1)
    text(r"p_{X,Y}(x,y)=\frac{1}{6}", 1, label=DocItemLabel.FORMULA)
    caption = text("Figure 1: joint probabilities", 1, label=DocItemLabel.CAPTION)
    doc.add_picture(prov=prov(1), caption=caption,
                    image=ImageRef.from_pil(Image.new("RGB", (4, 4), "white"), dpi=72))
    for page in range(1, 4):
        # Deliberately mislabeled as body text, with changing page numbers.
        text(f"Licensed to Taylor Example — page {page}", page, 780)
        text("Probability notes", page, 10)
        text("A useful repeated definition", page)
    doc.add_heading(text="Marginals", level=2, prov=prov(2))
    text("A second-page paragraph", 2)
    doc.add_heading(text="Exercises", level=3, prov=prov(2))
    doc.add_list_item(text="Find the marginal distribution.", enumerated=True, marker="1.",
                      parent=doc.add_list_group(), prov=prov(2))
    text(r"\sum_y p_{X,Y}(x,y)", 3, label=DocItemLabel.FORMULA)
    doc.add_list_item(text="Find the expectation.", enumerated=True, marker="2.",
                      parent=doc.add_list_group(), prov=prov(3))
    doc.add_heading(text="Next topic", level=1, prov=prov(3))
    text("Probability notes", 3)
    text("A genuine one-off footer note", 3, 780)
    return doc


def flatten(ir):
    return [node for section in ir["sections"] for node in walk(section)]


def walk(section):
    yield section
    for child in section["children"]:
        yield from walk(child)


def test_tree_markdown_figures_exercises_and_noise(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    nodes = flatten(ir)
    assert [s["title"] for s in nodes] == [
        "Probability", "Joint distributions", "Marginals", "Exercises", "Next topic",
    ]
    joint, marginal, exercises = nodes[1:4]
    assert joint["children"] == [marginal]
    assert marginal["children"] == [exercises]
    assert [s["level"] for s in nodes] == [0, 1, 2, 3, 1]
    assert joint["anchors"] == [{"page": 1}, {"page": 2}, {"page": 3}]
    assert r"p_{X,Y}" in joint["markdown"] and "$$" in joint["markdown"]
    assert "1. Find the marginal distribution." in exercises["exercises"][0]["markdown"]
    assert r"\sum_y" in exercises["exercises"][0]["markdown"]
    assert exercises["exercises"][0]["anchors"] == [{"page": 2}, {"page": 3}]
    rendered = json.dumps(ir)
    assert "Taylor Example" not in rendered
    assert sum(n["markdown"].count("Probability notes") for n in nodes) == 1
    assert "A useful repeated definition" in rendered
    assert "A genuine one-off footer note" in rendered
    assert len(exercises["exercises"]) == 2
    assert "Find the expectation." in exercises["exercises"][1]["markdown"]
    figure = joint["figures"][0]
    assert figure["caption"] == "Figure 1: joint probabilities"
    assert Path(figure["image_path"]).is_file()
    assert len({s["id"] for s in nodes}) == len(nodes)
    assert [s["id"] for s in flatten(ingest.document_to_ir(document, tmp_path))] == [s["id"] for s in nodes]


def test_list_sections_rpc(document, tmp_path):
    ir = ingest.document_to_ir(document, tmp_path)
    reply = handle({"id": 3, "method": "list_sections", "params": {"ir": ir}})
    assert reply == {"id": 3, "result": [
        {key: node[key] for key in ("id", "title", "level", "anchors")}
        for node in flatten(ir)
    ]}
    assert handle({"id": 4, "method": "list_sections", "params": {"ir": {"sections": []}}})["result"] == []


@pytest.mark.parametrize("params", [None, {}, {"path": ""}, {"path": 3}, {"path": "https://example.com/a.pdf"}])
def test_invalid_ingest_params(params, monkeypatch):
    monkeypatch.setattr(ingest, "_convert_pdf", lambda path: pytest.fail("converter loaded"))
    assert "error" in handle({"id": 5, "method": "ingest_pdf", "params": params})


@pytest.mark.parametrize("ir", [None, {}, {"sections": "bad"}, {"sections": [{}]},
                                  {"sections": [{"id": 1, "title": "A", "level": 1, "anchors": [], "children": []}]}])
def test_invalid_ir(ir):
    assert "error" in handle({"id": 6, "method": "list_sections", "params": {"ir": ir}})


def test_ingest_rpc_clean_stdout_and_recovery(document, tmp_path, monkeypatch, capsys):
    pdf = tmp_path / "test.pdf"
    pdf.write_bytes(b"%PDF-1.7\nfixture")

    def convert(path):
        assert path == pdf
        print("converter diagnostic")
        return document

    monkeypatch.setattr(ingest, "_convert_pdf", convert)
    requests = [
        {"id": 1, "method": "ingest_pdf", "params": {"path": str(tmp_path / "missing.pdf")}},
        {"id": 2, "method": "ingest_pdf", "params": {"path": str(pdf)}},
        {"id": 3, "method": "ping", "params": {}},
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))
    main()
    captured = capsys.readouterr()
    replies = [json.loads(line) for line in captured.out.splitlines()]
    assert "error" in replies[0]
    assert replies[1]["result"]["sections"]
    assert replies[2]["result"] == "pong"
    assert "converter diagnostic" in captured.err


def test_reject_non_pdf_before_conversion(tmp_path, monkeypatch):
    path = tmp_path / "fake.pdf"
    path.write_text("not a PDF")
    monkeypatch.setattr(ingest, "_convert_pdf", lambda path: pytest.fail("converter loaded"))
    assert "error" in handle({"id": 1, "method": "ingest_pdf", "params": {"path": str(path)}})


def test_single_page_without_headings_keeps_same_page_repetition(tmp_path):
    from docling_core.types.doc import BoundingBox, DoclingDocument, DocItemLabel, ProvenanceItem, Size
    doc = DoclingDocument(name="Untitled notes")
    doc.add_page(page_no=1, size=Size(width=600, height=800))
    for _ in range(2):
        doc.add_text(label=DocItemLabel.TEXT, text="A repeated line", prov=ProvenanceItem(
            page_no=1, charspan=(0, 15), bbox=BoundingBox(l=10, t=790, r=200, b=780),
        ))
    ir = ingest.document_to_ir(doc, tmp_path)
    assert len(ir["sections"]) == 1
    assert ir["sections"][0]["title"] == "Untitled notes"
    assert ir["sections"][0]["markdown"].count("A repeated line") == 2


def test_table_markdown_is_retained(document, tmp_path):
    from docling_core.types.doc import TableCell, TableData
    document.add_table(data=TableData(num_rows=1, num_cols=1, table_cells=[TableCell(
        text="Probability", start_row_offset_idx=0, end_row_offset_idx=1,
        start_col_offset_idx=0, end_col_offset_idx=1,
    )]), prov=document.texts[-1].prov[0])
    markdown = flatten(ingest.document_to_ir(document, tmp_path))[-1]["markdown"]
    assert "| Probability" in markdown


def test_partial_conversion_is_an_error(monkeypatch):
    monkeypatch.setattr(ingest, "_load_converter", lambda: SimpleNamespace(
        convert=lambda path: SimpleNamespace(status="partial_success", document=None),
    ))
    with pytest.raises(ValueError, match="incomplete"):
        ingest._convert_pdf(Path("unused.pdf"))


@pytest.mark.slow
def test_real_pdf(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[2] / "spikes/pdf/inputs/stat350_ch5_joint_pmfs.pdf"
    # Keep all extracted artifacts in the test directory, not beside the source.
    monkeypatch.setattr(ingest, "_assets_root", lambda: tmp_path)
    started = time.perf_counter()
    reply = handle({"id": 1, "method": "ingest_pdf", "params": {"path": str(source)}})
    elapsed = time.perf_counter() - started
    assert "error" not in reply, reply
    ir = reply["result"]
    nodes = flatten(ir)
    markdown = "\n".join(n["markdown"] for n in nodes)
    figures = [f for n in nodes for f in n["figures"]]
    pages = {a["page"] for n in nodes for a in n["anchors"]}
    metrics = {"wall_sec": round(elapsed, 2), "sections": len(nodes),
               "latex_survived": bool(re.search(r"\$\$[\s\S]*?\\[a-zA-Z]+", markdown)),
               "figures": len(figures), "pages": len(pages)}
    print(json.dumps(metrics), flush=True)
    (tmp_path / "metrics.json").write_text(json.dumps(metrics))
    (tmp_path / "ir.json").write_text(json.dumps(ir, indent=2))
    assert len(nodes) > 1
    assert pages == set(range(1, 14))
    assert metrics["latex_survived"]
    assert all(Path(f["image_path"]).is_file() for f in figures)
