"""PPTX and DOCX share ingest_pdf. Docling's OOXML reader needs no layout model."""
import pytest

from tangent_sidecar import handle
from tangent_sidecar import ingest


def _flat(ir):
    nodes = []

    def walk(section):
        nodes.append(section)
        for child in section["children"]:
            walk(child)

    for section in ir["sections"]:
        walk(section)
    return nodes


def _slides(path):
    from pptx import Presentation

    deck = Presentation()
    first = deck.slides.add_slide(deck.slide_layouts[0])
    first.shapes.title.text = "Heaps"
    first.placeholders[1].text = "A heap is a tree."
    second = deck.slides.add_slide(deck.slide_layouts[1])
    second.shapes.title.text = "Heapify"
    second.placeholders[1].text = "Sift the root down."
    deck.save(path)


def _notes(path):
    from docx import Document

    doc = Document()
    doc.add_heading("Heaps", level=1)
    doc.add_paragraph("A heap is a tree.")
    doc.add_heading("Heapify", level=2)
    doc.add_paragraph("Sift the root down.")
    doc.save(path)


def test_pptx_and_docx_ir_uses_passages_without_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "_convert_pdf", lambda *args, **kwargs: pytest.fail("pdf pipeline"))
    pptx, docx = tmp_path / "slides.pptx", tmp_path / "notes.docx"
    _slides(pptx)
    _notes(docx)
    slides = ingest.ingest_pdf({"path": str(pptx)})
    notes = ingest.ingest_pdf({"path": str(docx)})
    assert [n["title"] for n in slides["sections"]] == ["Heaps", "Heapify"]
    assert [n["level"] for n in slides["sections"]] == [1, 1]
    assert notes["sections"][0]["title"] == "Heaps"
    assert notes["sections"][0]["children"][0]["title"] == "Heapify"
    for ir in (slides, notes):
        nodes = _flat(ir)
        assert "formulas" not in ir
        assert all(n["anchors"] == [] for n in nodes)
        passages = [p for n in nodes for p in n["passages"]]
        assert any("heap is a tree" in p["markdown"] for p in passages)
        assert all(p["boxes"] == [] and p["id"].startswith("p") for p in passages)


def test_office_rejects_other_files_before_conversion(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "_convert_office", lambda path: pytest.fail("office converter"))
    monkeypatch.setattr(ingest, "_convert_pdf", lambda *args, **kwargs: pytest.fail("pdf pipeline"))
    txt = tmp_path / "notes.txt"
    txt.write_text("no")
    fake = tmp_path / "deck.pptx"
    fake.write_bytes(b"not a zip")
    doc = tmp_path / "notes.docx"
    doc.write_text("no")
    for path in (txt, fake, doc):
        assert "error" in handle({"id": 1, "method": "ingest_pdf", "params": {"path": str(path)}})
    real = tmp_path / "ok.pptx"
    _slides(real)
    assert "error" in handle({"id": 2, "method": "ingest_pdf", "params": {"path": str(real), "pages": [1, 1]}})


def test_pdf_header_still_required(tmp_path, monkeypatch):
    path = tmp_path / "fake.pdf"
    path.write_bytes(b"PK\x03\x04not a pdf")
    monkeypatch.setattr(ingest, "_convert_pdf", lambda *args, **kwargs: pytest.fail("pdf pipeline"))
    monkeypatch.setattr(ingest, "_convert_office", lambda path: pytest.fail("office converter"))
    assert "error" in handle({"id": 1, "method": "ingest_pdf", "params": {"path": str(path)}})
