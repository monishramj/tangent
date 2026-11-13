"""Whole-book ingest leaves formulas as tokens; enrich_formulas decodes only the requested sections."""
from docling_core.types.doc import BoundingBox, CoordOrigin, DoclingDocument, DocItemLabel, ProvenanceItem, Size

from tangent_sidecar import ingest


def doc_with(formulas):
    doc = DoclingDocument(name="Notes")
    for page in (1, 2):
        doc.add_page(page_no=page, size=Size(width=600, height=800))

    def prov(page, y):
        return ProvenanceItem(page_no=page, charspan=(0, 0), bbox=BoundingBox(
            l=100, t=y, r=500, b=y + 40, coord_origin=CoordOrigin.TOPLEFT))

    doc.add_heading(text="One", level=1, prov=prov(1, 10))
    doc.add_text(label=DocItemLabel.TEXT, text="Before.", prov=prov(1, 100))
    doc.add_text(label=DocItemLabel.FORMULA, text=formulas[0], orig="x 2 + y", prov=prov(1, 200))
    doc.add_heading(text="Two", level=1, prov=prov(2, 10))
    doc.add_text(label=DocItemLabel.FORMULA, text=formulas[1], orig="a b", prov=prov(2, 300))
    return doc


def test_ingest_tokens_then_enrich_only_requested(tmp_path, monkeypatch):
    ir = ingest.document_to_ir(doc_with(["", ""]), tmp_path)
    one, two = ir["sections"]
    assert ingest.formula_token("1") in one["markdown"] and ingest.formula_token("2") in two["markdown"]
    assert set(ir["formulas"]) == {"1", "2"}

    seen = []
    monkeypatch.setattr(ingest, "_convert_pdf", lambda path, pages=None, formulas=False:
                        seen.append((pages, formulas)) or doc_with([r"x^2+y", r"a \cdot b"]))
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    out = ingest.enrich_formulas({"path": str(pdf), "ir": ir, "ids": [one["id"]]})
    assert seen == [((1, 1), True)]
    assert "$$x^2+y$$" in out["sections"][0]["markdown"]
    assert "$$x^2+y$$" in out["sections"][0]["passages"][-1]["markdown"]
    assert ingest.formula_token("2") in out["sections"][1]["markdown"]  # untouched until its own video
    assert set(out["formulas"]) == {"2"}

    # Unmatched formula falls back to the text layer; nothing left pending afterwards.
    monkeypatch.setattr(ingest, "_convert_pdf", lambda *a, **k: doc_with(["", ""]))
    done = ingest.enrich_formulas({"path": str(pdf), "ir": out, "ids": [two["id"]]})
    assert "$$a b$$" in done["sections"][1]["markdown"] and "formulas" not in done
    assert ingest.enrich_formulas({"path": str(pdf), "ir": done, "ids": [two["id"]]}) is done  # no model call


def test_match_tolerance():
    wanted = {"1": {"page": 1, "bbox": [.1, .1, .5, .2]}}
    assert ingest.match_formulas(wanted, [(1, [.105, .1, .5, .2], "ok"), (2, [.1, .1, .5, .2], "wrong page")]) == {"1": "ok"}
    assert ingest.match_formulas(wanted, [(1, [.3, .5, .9, .6], "far")]) == {}


def test_formula_model_avoids_cpu_bf16():
    o = ingest._formula_options()
    assert all(c.extra_config.get("torch_dtype") != "bfloat16" for c in o.model_spec.engine_overrides.values())
