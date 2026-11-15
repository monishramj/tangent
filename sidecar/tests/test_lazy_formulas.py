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
    assert out["formula_fidelity"]["1"]["fidelity"] == "verified"
    assert out["formula_disagreements"] == 0
    assert "$$x^2+y$$" in out["sections"][0]["markdown"]
    assert "$$x^2+y$$" in out["sections"][0]["passages"][-1]["markdown"]
    assert ingest.formula_token("2") in out["sections"][1]["markdown"]  # untouched until its own video
    assert set(out["formulas"]) == {"2"}

    # Unmatched formula falls back to the text layer; nothing left pending afterwards.
    monkeypatch.setattr(ingest, "_convert_pdf", lambda *a, **k: doc_with(["", ""]))
    done = ingest.enrich_formulas({"path": str(pdf), "ir": out, "ids": [two["id"]]})
    assert done["formula_fidelity"]["2"]["fidelity"] == "fallback"
    assert done["formula_disagreements"] == 1
    assert "a b" in done["sections"][1]["markdown"] and "formulas" not in done
    assert ingest.enrich_formulas({"path": str(pdf), "ir": done, "ids": [two["id"]]}) is done  # no model call


def test_match_tolerance():
    wanted = {"1": {"page": 1, "bbox": [.1, .1, .5, .2]}}
    assert ingest.match_formulas(wanted, [(1, [.105, .1, .5, .2], "ok"), (2, [.1, .1, .5, .2], "wrong page")]) == {"1": "ok"}
    assert ingest.match_formulas(wanted, [(1, [.3, .5, .9, .6], "far")]) == {}


def test_formula_model_avoids_cpu_bf16():
    o = ingest._formula_options()
    assert all(c.extra_config.get("torch_dtype") != "bfloat16" for c in o.model_spec.engine_overrides.values())


def test_recorded_formula_decodes():
    import json
    from pathlib import Path
    from tangent_sidecar.formula_fidelity import check_formula

    examples = json.loads((Path(__file__).parent / "fixtures/formula_decodes.json").read_text())["examples"]
    assert len(examples) == 10
    for example in examples:
        replacement, fidelity, reasons = check_formula(example["decoded"], example["orig"])
        n = example["id"].split()[0]
        if n in {"1", "8", "18"}:
            assert fidelity == "verified", (n, reasons)
            assert replacement.startswith("$$")
        else:
            assert fidelity == "fallback", (n, reasons)
        if n == "11":
            assert "numbers" in reasons and "0.8413" in replacement and "0.813" not in replacement
        if n == "22":
            assert "symbols" in reasons and r"\bar" in replacement
        if n == "28":
            assert "malformed LaTeX" in reasons
        if n in {"3", "4"}:
            assert "6 4" not in replacement and "64" in replacement


def test_formula_fidelity_cases():
    from tangent_sidecar.formula_fidelity import check_formula
    cases = [
        (r"x_{new}=64", r"x_{new}=64", "verified"),
        (r"x=64", r"x_{new}=64", "fallback"),
        (r"x=64", r"x^2=64", "fallback"),
        (r"x=64", "x̂=64", "fallback"),
        (r"x=64", "x̄=64", "fallback"),
        (r"x=64", "x₂=64", "fallback"),
        (r"x=64", "x²=64", "fallback"),
        (r"x=64", "x≤64", "fallback"),
        (r"xy=64", "x/y=64", "fallback"),
        (r"x=64", "x=64%", "fallback"),
        (r"x=64", "x!=64", "fallback"),
        (r"x={64", "x=64", "fallback"),
        ("x=64\\", "x=64", "fallback"),
        (r"\sqrt{ }", "✓", "fallback"),
        (r"x=64", "", "unverified"),
        (r"x=64", "�64", "unverified"),
        (r"x=64", "\ue00064", "unverified"),
        (r"x=64", "(cid:99)64", "unverified"),
        (r"x=64", "x=6\x00", "unverified"),
        ("x=64", "x=-64", "fallback"),
        ("x=64+64", "x=64", "fallback"),
    ]
    for decoded, orig, expected in cases:
        replacement, fidelity, reasons = check_formula(decoded, orig)
        assert fidelity == expected, (decoded, orig, reasons)
        if fidelity == "unverified":
            assert not any(c.isdigit() for c in replacement)
    assert check_formula(r"x=6 4", "x=64") == ("$$x=64$$", "verified", [])
    assert check_formula("p=1 . 0 0", "p=1.00") == ("$$p=1.00$$", "verified", [])
    correct = r"x^2+\hat{y}=64"
    assert check_formula(correct, correct) == (f"$${correct}$$", "verified", [])


def test_fidelity_splices_all_surfaces_and_counts(capsys):
    token = ingest.formula_token("1")
    ir = {"sections": [{"id": "s", "markdown": token, "passages": [{"markdown": token}],
                        "exercises": [{"markdown": token}], "children": []}],
          "formulas": {"1": {"orig": "�64"}}}
    out = ingest.splice_formulas(ir, ir["formulas"], {"1": "x=64"})
    assert out["formula_fidelity"]["1"]["fidelity"] == "unverified"
    assert out["formula_disagreements"] == 1
    assert "unverified" in capsys.readouterr().err
    assert "64" not in str(out["sections"])
    assert "64" not in ingest.section_text(out, "s")
    assert "�64" == ir["formulas"]["1"]["orig"]
    out["formulas"] = {"2": {"orig": "p=0.8413"}}
    done = ingest.splice_formulas(out, out["formulas"], {"2": "p=0.813"})
    assert done["formula_disagreements"] == 2
    assert done["formula_fidelity"]["2"]["fidelity"] == "fallback"
    assert done["formula_fidelity"]["1"]["fidelity"] == "unverified"
