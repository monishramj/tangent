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


@pytest.mark.parametrize("env,expected", [("cpu", "cpu"), ("mps", "mps"), (None, "auto"), ("", "auto")])
def test_pick_device(env, expected):
    assert ingest._pick_device(env) == expected


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

    def convert(path, pages):
        assert path == pdf
        print("converter diagnostic")
        return document

    monkeypatch.setattr(ingest, "_convert_pdf", convert)
    monkeypatch.setattr(ingest, "pdf_info", lambda params: {"pages": 3})
    requests = [
        {"id": 1, "method": "ingest_pdf", "params": {"path": str(tmp_path / "missing.pdf")}},
        {"id": 2, "method": "ingest_pdf", "params": {"path": str(pdf)}},
        {"id": 3, "method": "ping", "params": {}},
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))
    main()
    captured = capsys.readouterr()
    messages = [json.loads(line) for line in captured.out.splitlines()]
    replies = [message for message in messages if "progress" not in message]
    assert [m["progress"]["completed"] for m in messages if "progress" in m] == [0, 3]
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
    monkeypatch.setattr(ingest, "_load_converter", lambda formulas=False: SimpleNamespace(
        convert=lambda path: SimpleNamespace(status="partial_success", document=None),
    ))
    with pytest.raises(ValueError, match="incomplete"):
        ingest._convert_pdf(Path("unused.pdf"))


@pytest.mark.slow
def test_real_pdf(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[2] / "spikes/pdf/inputs/stat350_ch5_joint_pmfs.pdf"
    if not source.is_file():
        pytest.skip("local course PDF is not in the repo")
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


def test_assets_dir_param_is_used_and_validated(document, tmp_path, monkeypatch):
    pdf = tmp_path / "t.pdf"
    pdf.write_bytes(b"%PDF-1.7\nfixture")
    monkeypatch.setattr(ingest, "_convert_pdf", lambda path, pages: document)
    monkeypatch.setattr(ingest, "pdf_info", lambda params: {"pages": 3})
    out = tmp_path / "figs" / "src1"
    ir = handle({"id": 1, "method": "ingest_pdf", "params": {"path": str(pdf), "assets_dir": str(out)}})["result"]
    figure = next(f for n in flatten(ir) for f in n["figures"])
    assert Path(figure["image_path"]).parent == out.resolve() and Path(figure["image_path"]).is_file()
    for bad in ("relative/dir", 3):
        assert "error" in handle({"id": 2, "method": "ingest_pdf", "params": {"path": str(pdf), "assets_dir": bad}})


def test_figure_without_image_is_skipped(document, tmp_path, monkeypatch, capsys):
    from docling_core.types.doc import PictureItem
    monkeypatch.setattr(PictureItem, "get_image", lambda self, doc, *a, **k: None)
    nodes = flatten(ingest.document_to_ir(document, tmp_path))
    assert not any(n["figures"] for n in nodes)
    assert "skipping" in capsys.readouterr().err


@pytest.mark.parametrize("title", ["Check yourself", "Self-check", "Checkpoint", "Quick Check", "Try it",
                                   "Participation Activity 2.1", "Challenge activity", "Problems", "Questions", "Exercises"])
def test_exercise_heading_conventions(title):
    assert ingest.EXERCISE_HEADING.search(title)


@pytest.mark.parametrize("title", ["Marginals", "Joint distributions", "Checking account"])
def test_non_exercise_headings(title):
    assert not ingest.EXERCISE_HEADING.search(title)


def test_pdf_info(tmp_path):
    import pypdfium2
    pdf = pypdfium2.PdfDocument.new()
    for _ in range(3):
        pdf.new_page(200, 200)
    path = tmp_path / "three.pdf"
    pdf.save(str(path))
    assert handle({"id": 1, "method": "pdf_info", "params": {"path": str(path)}}) == {"id": 1, "result": {"pages": 3}}
    for params in (None, {}, {"path": ""}, {"path": str(tmp_path / "nope.pdf")}):
        assert "error" in handle({"id": 2, "method": "pdf_info", "params": params})


def test_chunk_progress_stitching_and_thermal_pause(tmp_path, monkeypatch):
    from docling_core.types.doc import BoundingBox, DoclingDocument, DocItemLabel, ProvenanceItem, Size
    from tangent_sidecar import limits
    doc = DoclingDocument(name="Chapter")
    for page in range(1, 42):
        doc.add_page(page_no=page, size=Size(width=600, height=800))
        prov = ProvenanceItem(page_no=page, charspan=(0, 0), bbox=BoundingBox(l=10, t=400, r=500, b=420))
        if page == 1:
            doc.add_heading(text="Chapter", level=1, prov=prov)
        if page == 20:
            doc.add_heading(text="Exercises", level=2, prov=prov)
        doc.add_text(label=DocItemLabel.TEXT, text=f"Unique content for page {page}.", prov=prov)
        if page in (20, 21):
            doc.add_text(label=DocItemLabel.FORMULA, text="", orig=f"x {page}", prov=prov)
    pdf = tmp_path / "chapter.pdf"
    pdf.write_bytes(b"%PDF-1.7\nfixture")
    monkeypatch.setattr(ingest, "pdf_info", lambda params: {"pages": 41})
    conversions, events = [], []
    def convert(path, pages):
        conversions.append(pages)
        return doc.filter(page_nrs=set(range(pages[0], pages[1] + 1)))
    monkeypatch.setattr(ingest, "_convert_pdf", convert)
    states = iter([0, 2, 3, 1, 0, 0])
    monkeypatch.setattr(ingest, "wait_until_cool", lambda paused: limits.wait_until_cool(
        source=lambda: next(states), sleep=lambda _: events.append("wait"), paused=paused))
    ir = ingest.ingest_pdf({"path": str(pdf), "assets_dir": str(tmp_path)}, progress=events.append)
    expected = ingest.document_to_ir(doc, tmp_path, pdf)
    assert ir == expected
    assert conversions == [(1, 20), (21, 40), (41, 41)]
    assert [value["page"] for value in ir["formulas"].values()] == [20, 21]
    assert [e["completed"] for e in events if isinstance(e, dict) and not e["paused"]] == [0, 20, 40, 41]
    assert [e["completed"] for e in events if isinstance(e, dict) and e["paused"]] == [20, 20]
    assert events.count("wait") == 2
    assert ir["sections"][0]["children"][0]["anchors"][-1] == {"page": 41}


def test_join_keeps_figures_formulas_and_original_range_anchors(document, tmp_path):
    # Docling's filter and concatenate remap references and normalize page numbers.
    chunks = [document.filter(page_nrs={1}), document.filter(page_nrs={2, 3})]
    joined = ingest._join_documents(chunks, 1)
    assert ingest.document_to_ir(joined, tmp_path) == ingest.document_to_ir(document, tmp_path)
    ranged = ingest._join_documents([document.filter(page_nrs={2}), document.filter(page_nrs={3})], 2)
    assert set(ranged.pages) == {2, 3}
    assert {p.page_no for item, _ in ranged.iterate_items() for p in item.prov} == {2, 3}
