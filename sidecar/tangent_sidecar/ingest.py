"""Docling PDF adapter. The IR contains only JSON values and local figure paths."""

import math
import os
import re
import sys
import tempfile
from collections import defaultdict
from contextlib import redirect_stdout
from functools import lru_cache
from pathlib import Path

from .postprocess import strip_footers


@lru_cache(maxsize=1)
def _load_converter():
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    options = PdfPipelineOptions(
        do_formula_enrichment=True, generate_picture_images=True,
        images_scale=2.0, do_ocr=False,
        accelerator_options=AcceleratorOptions(
            device=os.environ.get("TANGENT_DEVICE", device),
            num_threads=int(os.environ.get("TANGENT_THREADS", "8")),
        ),
    )
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


def _convert_pdf(path, pages=None):
    from docling.datamodel.base_models import ConversionStatus

    result = _load_converter().convert(path, **({"page_range": pages} if pages else {}))
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
        return {"pages": len(pdf)}
    finally:
        pdf.close()


def _assets_root():
    return Path(__file__).resolve().parents[1] / ".ingest"


def ingest_pdf(params):
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
        document = _convert_pdf(path, pages) if pages else _convert_pdf(path)
        if assets_dir is not None:
            assets = Path(assets_dir)
            assets.mkdir(parents=True, exist_ok=True)
        else:
            root = _assets_root()
            root.mkdir(parents=True, exist_ok=True)
            assets = Path(tempfile.mkdtemp(prefix="pdf-", dir=root))
        return document_to_ir(document, assets)


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


def document_to_ir(document, assets):
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

    def section(title, level):
        nonlocal exercise
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        node = {"id": f"section-{len(all_sections) + 1}", "title": title, "level": level,
                "markdown": "", "figures": [], "exercises": [], "anchors": [], "children": []}
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
        if hasattr(item, "text") and not item.text.strip():
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
        else:
            markdown = serializer.serialize(item=item).text.strip()
        if not markdown:
            continue
        current["markdown"] += ("\n\n" if current["markdown"] else "") + markdown

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
    return postprocess({"sections": sections})


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
