"""Docling PDF adapter. The IR contains only JSON values and local figure paths."""

import base64
import io
import math
import os
import re
import sys
import tempfile
from collections import defaultdict
from contextlib import redirect_stdout
from functools import lru_cache
from pathlib import Path

from .limits import limit_torch, threads, wait_until_cool
from .postprocess import strip_footers


def _pick_device(env):
    # "auto": Docling picks CUDA/MPS per model; the formula model (no MPS support) falls back to CPU on its own.
    # Forcing "mps" makes that model raise.
    return env or "auto"


def _formula_options():
    from docling.datamodel.pipeline_options import CodeFormulaVlmOptions

    o = CodeFormulaVlmOptions.from_preset("codeformulav2").model_copy(deep=True)  # presets are shared objects
    # Formulas run token-by-token on CPU; a runaway generation burned up to 4096 tokens each.
    o.model_spec.max_new_tokens = 512  # ponytail: raise if long display equations come back truncated
    o.extract_code = False  # code enrichment is off; never send code blocks through the model
    # The preset forces bf16, which PyTorch runs on Apple CPUs through a scalar fallback:
    # measured 65x slower per matvec than fp32 (Accelerate) on the M4 Max. fp32 costs ~2x RAM for this small model.
    for cfg in o.model_spec.engine_overrides.values():
        if cfg.extra_config.get("torch_dtype") == "bfloat16":
            cfg.extra_config["torch_dtype"] = "float32"
    return o


@lru_cache(maxsize=2)
def _load_converter(formulas=False):
    """formulas=False: the whole-book ingest (no formula model, the heat source).
    formulas=True: only for the pages of sections a video is made from (enrich_formulas)."""
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode, TableStructureOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    limit_torch()
    device = _pick_device(os.environ.get("TANGENT_DEVICE"))
    options = PdfPipelineOptions(
        do_formula_enrichment=formulas, generate_picture_images=not formulas,
        do_table_structure=not formulas, images_scale=2.0, do_ocr=False,
        code_formula_options=_formula_options(),
        table_structure_options=TableStructureOptions(mode=TableFormerMode.FAST),  # cheaper than ACCURATE
        accelerator_options=AcceleratorOptions(
            device=device,
            num_threads=threads(),
        ),
    )
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


def _convert_pdf(path, pages=None, formulas=False):
    from docling.datamodel.base_models import ConversionStatus

    result = _load_converter(formulas).convert(path, **({"page_range": pages} if pages else {}))
    if result.status != ConversionStatus.SUCCESS:
        raise ValueError(f"PDF conversion incomplete: {result.status}")
    return result.document


EXERCISE_HEADING = re.compile(
    r"\b(exercises?|review questions?|practice problems?|activit(?:y|ies)|check yourself|self[- ]check|"
    r"checkpoints?|quick check|try it|participation activit(?:y|ies)|challenge activit(?:y|ies)|problems|questions)\b", re.I)


def pdf_info(params):
    if not isinstance(params, dict) or not isinstance(params.get("path"), str) or not params["path"].strip():
        raise ValueError("path must be a non-empty local PDF path")
    import pypdfium2

    pdf = pypdfium2.PdfDocument(str(Path(params["path"]).expanduser().resolve(strict=True)))
    try:
        result = {"pages": len(pdf)}
        if params.get("preview") and len(pdf):
            page = pdf[0]
            bitmap = page.render(scale=0.35)
            try:
                output = io.BytesIO()
                bitmap.to_pil().save(output, format="PNG")
                result["thumbnailUrl"] = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
            finally:
                bitmap.close()
                page.close()
        return result
    finally:
        pdf.close()


def _assets_root():
    return Path(__file__).resolve().parents[1] / ".ingest"


def _join_documents(documents, first_page):
    from docling_core.types.doc import ContentLayer, DoclingDocument

    document = DoclingDocument.concatenate(documents)
    # concatenate rebases to page 1; range ingests must retain original PDF anchors.
    offset = first_page - 1
    if offset:
        document.pages = {n + offset: page.model_copy(update={"page_no": n + offset})
                          for n, page in document.pages.items()}
        for item, _ in document.iterate_items(included_content_layers=set(ContentLayer)):
            for prov in item.prov:
                prov.page_no += offset
    return document


def ingest_pdf(params, progress=lambda value: None):
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    value = params.get("path")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("path must be a non-empty local PDF path")
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_file():
        raise ValueError("path must be a local PDF file")
    with path.open("rb") as stream:
        if not stream.read(1024).lstrip().startswith(b"%PDF-"):
            raise ValueError("path must contain a PDF")
    pages = params.get("pages")
    if pages is not None:
        if (not isinstance(pages, list) or len(pages) != 2 or any(type(p) is not int for p in pages)
                or not 1 <= pages[0] <= pages[1]):
            raise ValueError("pages must be [first, last], 1-based and ascending")
        pages = tuple(pages)
    assets_dir = params.get("assets_dir")
    if assets_dir is not None and (not isinstance(assets_dir, str) or not os.path.isabs(assets_dir)):
        raise ValueError("assets_dir must be an absolute path")
    # Model diagnostics must never become JSON-lines responses.
    with redirect_stdout(sys.stderr):
        total_pages = pdf_info({"path": str(path)})["pages"]
        first, last = pages or (1, total_pages)
        if last > total_pages:
            raise ValueError("pages exceed PDF page count")
        total = last - first + 1
        documents = []
        def report(completed, paused=False):
            progress({"completed": completed, "total": total, "paused": paused})
        report(0)
        for start in range(first, last + 1, 20):
            wait_until_cool(paused=lambda: report(start - first, True))
            end = min(start + 19, last)
            documents.append(_convert_pdf(path, (start, end)))
            report(end - first + 1)
        wait_until_cool(paused=lambda: report(total, True))
        document = _join_documents(documents, first)
        if assets_dir is not None:
            assets = Path(assets_dir)
            assets.mkdir(parents=True, exist_ok=True)
        else:
            root = _assets_root()
            root.mkdir(parents=True, exist_ok=True)
            assets = Path(tempfile.mkdtemp(prefix="pdf-", dir=root))
        return document_to_ir(document, assets, path)


def _line_key(line):
    return re.sub(r"\d+", "#", " ".join(line.casefold().split()))


def _repeated_margins(document, items):
    occurrences = defaultdict(set)
    candidates = defaultdict(set)
    for item in items:
        for prov in item.prov:
            page = document.pages.get(prov.page_no)
            if page is None or not page.size.height:
                continue
            bbox = prov.bbox.to_top_left_origin(page_height=page.size.height)
            if bbox.b <= page.size.height * .15 or bbox.t >= page.size.height * .85:
                for line in getattr(item, "text", "").splitlines():
                    if line.strip():
                        key = _line_key(line)
                        occurrences[key].add(prov.page_no)
                        candidates[item.self_ref].add(key)
    minimum = max(2, math.ceil(len(document.pages) / 2))
    repeated = {line for line, pages in occurrences.items() if len(pages) >= minimum}
    return {ref: lines & repeated for ref, lines in candidates.items()}


def _boxes(document, item):
    """One box per provenance entry: [x0, y0, x1, y1] as page fractions, top-left origin."""
    boxes = []
    for prov in item.prov:
        page = document.pages.get(prov.page_no)
        if page is None or not page.size.width or not page.size.height:
            continue
        b = prov.bbox.to_top_left_origin(page_height=page.size.height)
        x0, x1 = sorted((b.l, b.r))
        y0, y1 = sorted((b.t, b.b))
        w, h = page.size.width, page.size.height
        box = [round(min(1.0, max(0.0, v)), 4) for v in (x0 / w, y0 / h, x1 / w, y1 / h)]
        boxes.append({"page": prov.page_no, "bbox": box})
    return boxes


def document_to_ir(document, assets, pdf_path=None):
    from docling_core.transforms.serializer.markdown import MarkdownDocSerializer
    from docling_core.types.doc import ContentLayer

    # Work on a copy: callers can reuse their Docling result unchanged.
    document = document.model_copy(deep=True)
    items = [item for item, _ in document.iterate_items(included_content_layers=set(ContentLayer))]
    repeated = _repeated_margins(document, items)
    for item in document.texts:
        item.text = "\n".join(line for line in item.text.splitlines()
                              if _line_key(line) not in repeated.get(item.self_ref, set()))
    serializer = MarkdownDocSerializer(doc=document)
    captions = {ref.cref for item in items for ref in getattr(item, "captions", [])}
    sections, stack = [], []
    exercise = None
    figure_count = 0
    passage_count = 0
    formulas = {}  # n -> {page, bbox, orig}: undecoded formulas, filled in later by enrich_formulas

    def section(title, level):
        nonlocal exercise
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        node = {"id": f"section-{len(all_sections) + 1}", "title": title, "level": level,
                "markdown": "", "figures": [], "exercises": [], "anchors": [], "children": [],
                "passages": []}
        (stack[-1]["children"] if stack else sections).append(node)
        stack.append(node)
        all_sections.append(node)
        exercise = None
        return node

    all_sections = []
    for item in items:
        label = item.label.value
        if (label in {"page_header", "page_footer"} or item.content_layer == ContentLayer.FURNITURE
                or item.self_ref in captions):
            continue
        pending = label == "formula" and not item.text.strip()
        if hasattr(item, "text") and not item.text.strip() and not (pending and (item.orig or "").strip()):
            continue
        if label in {"section_header", "title"}:
            current = section(item.text, getattr(item, "level", 1))
        else:
            current = stack[-1] if stack else section(document.name, 0)

        anchors = [{"page": page} for page in sorted({p.page_no for p in item.prov})]
        for ancestor in stack:
            ancestor["anchors"] = [{"page": p} for p in sorted(
                {a["page"] for a in ancestor["anchors"] + anchors})]

        if label in {"section_header", "title"}:
            continue
        if label == "picture":
            figure_count += 1
            figure_id = f"figure-{figure_count}"
            image = item.get_image(document)
            if image is None:
                print(f"warning: Docling did not extract an image for {figure_id}; skipping", file=sys.stderr)
                continue
            assets.mkdir(parents=True, exist_ok=True)
            image_path = (assets / f"{figure_id}.png").resolve()
            image.save(image_path)
            caption = item.caption_text(document)
            current["figures"].append({"id": figure_id, "caption": caption, "image_path": str(image_path)})
            markdown = f"![{caption}]({image_path.as_uri()})"
        elif pending:
            boxes = _boxes(document, item)
            n = str(len(formulas) + 1)
            formulas[n] = {**(boxes[0] if boxes else {"page": 0, "bbox": [0, 0, 0, 0]}), "orig": item.orig.strip()}
            markdown = formula_token(n)
        else:
            markdown = serializer.serialize(item=item).text.strip()
        if not markdown:
            continue
        current["markdown"] += ("\n\n" if current["markdown"] else "") + markdown
        passage_count += 1
        current["passages"].append({"id": f"p{passage_count}", "markdown": markdown, "boxes": _boxes(document, item)})

        if any(EXERCISE_HEADING.search(s["title"]) for s in stack):
            if (exercise is None or getattr(item, "enumerated", False)
                    or re.match(r"^\s*\d+[.)]\s", getattr(item, "text", ""))):
                exercise = {"id": f"{current['id']}-exercise-{len(current['exercises']) + 1}",
                            "markdown": "", "anchors": []}
                current["exercises"].append(exercise)
            exercise["markdown"] += ("\n\n" if exercise["markdown"] else "") + markdown
            for anchor in anchors:
                if anchor not in exercise["anchors"]:
                    exercise["anchors"].append(anchor)
    from .postprocess import postprocess
    return postprocess({"sections": sections, **({"formulas": formulas} if formulas else {})}, pdf_path)


def list_sections(params):
    if not isinstance(params, dict) or not isinstance(params.get("ir"), dict):
        raise ValueError("ir must be an object with a sections array")
    flat = []

    def visit(nodes):
        if not isinstance(nodes, list):
            raise ValueError("sections and children must be arrays")
        for node in nodes:
            if (not isinstance(node, dict)
                    or any(not isinstance(node.get(key), str) for key in ("id", "title"))
                    or type(node.get("level")) is not int or node["level"] < 0
                    or not isinstance(node.get("anchors"), list)):
                raise ValueError("invalid IR section")
            if any(not isinstance(a, dict) or type(a.get("page")) is not int or a["page"] < 1
                   for a in node["anchors"]):
                raise ValueError("invalid page anchor")
            flat.append({key: node[key] for key in ("id", "title", "level", "anchors")})
            visit(node.get("children", []))

    visit(params["ir"].get("sections"))
    return flat


def section_text(params_or_ir, section_id=None):
    """Own markdown of a section plus all descendants', in document order."""
    if section_id is None:  # RPC form: {"ir": ..., "id": ...}
        params_or_ir, section_id = params_or_ir.get("ir"), params_or_ir.get("id")
    if not isinstance(params_or_ir, dict) or not isinstance(params_or_ir.get("sections"), list):
        raise ValueError("ir must be an object with a sections array")

    def find(nodes):
        for n in nodes:
            if n["id"] == section_id:
                return n
            if (hit := find(n.get("children", []))):
                return hit

    def texts(n):
        yield n["markdown"]
        for c in n.get("children", []):
            yield from texts(c)

    node = find(params_or_ir["sections"])
    if node is None:
        raise ValueError(f"unknown section: {section_id}")
    return strip_footers("\n\n".join(t for t in texts(node) if t))


def repair_sections(params):
    """Upgrade flat cached outlines when the PDF has a bookmark tree."""
    import copy
    from .postprocess import pdf_outline, postprocess
    list_sections(params)
    if not isinstance(params.get("path"), str):
        raise ValueError("path must be a PDF path")
    ir = params["ir"]
    if any(n.get("children") for n in ir["sections"]) or not pdf_outline(params["path"]):
        return {**ir, "outline_version": 1}
    result = postprocess(copy.deepcopy(ir), params["path"])
    list_sections({"ir": result})
    return result


FORMULA_TOKEN = re.compile(r"⟨formula (\d+)⟩")


def formula_token(n):
    return f"⟨formula {n}⟩"


def _map_strings(value, fn):
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_map_strings(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _map_strings(v, fn) for k, v in value.items()}
    return value


def match_formulas(wanted, found, tolerance=0.02):
    """wanted: {n: {page, bbox}}; found: [(page, bbox, latex)]. Nearest same-page box within tolerance."""
    out = {}
    for n, f in wanted.items():
        best = min(((max(abs(a - b) for a, b in zip(f["bbox"], box)), latex)
                    for page, box, latex in found if page == f["page"]), default=None)
        if best and best[0] <= tolerance:
            out[n] = best[1]
    return out


def splice_formulas(ir, wanted, latex):
    """Replace the tokens of `wanted` everywhere in the IR: LaTeX when decoded, else the PDF text layer."""
    def fill(n):
        if n in latex:
            return f"$${latex[n]}$$"
        orig = wanted[n]["orig"]
        return f"$${orig}$$" if orig else ""

    sections = _map_strings(ir["sections"], lambda t: FORMULA_TOKEN.sub(
        lambda m: fill(m[1]) if m[1] in wanted else m[0], t))
    rest = {n: f for n, f in ir.get("formulas", {}).items() if n not in wanted}
    out = {k: v for k, v in ir.items() if k != "formulas"}
    out["sections"] = sections
    return {**out, "formulas": rest} if rest else out


def enrich_formulas(params):
    """Decode only the formulas inside the given sections (one Docling pass over their pages)."""
    if not isinstance(params, dict) or not isinstance(params.get("ir"), dict) or not isinstance(params.get("ids"), list):
        raise ValueError("params must be {path, ir, ids}")
    ir = params["ir"]
    pending = ir.get("formulas") or {}
    if not pending:
        return ir
    text = "\n".join(section_text(ir, i) for i in params["ids"])
    wanted = {n: pending[n] for n in dict.fromkeys(FORMULA_TOKEN.findall(text)) if n in pending}
    if not wanted:
        return ir
    path = Path(params["path"]).expanduser().resolve(strict=True)
    pages = [f["page"] for f in wanted.values() if f["page"] >= 1]
    found = []
    if pages:
        with redirect_stdout(sys.stderr):
            document = _convert_pdf(path, (min(pages), max(pages)), formulas=True)
        found = [(b["page"], b["bbox"], item.text.strip()) for item in document.texts
                 if item.label.value == "formula" and item.text.strip() for b in _boxes(document, item)[:1]]
    return splice_formulas(ir, wanted, match_formulas(wanted, found))
