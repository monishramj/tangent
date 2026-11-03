import sys, json, time, pathlib, resource
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import ImageRefMode

po = PdfPipelineOptions(do_formula_enrichment=True, generate_picture_images=True, images_scale=2.0, do_code_enrichment=True)
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=po)})
OUT = pathlib.Path(__file__).parent / "out"
res = []
for f in sys.argv[1:]:
    p = pathlib.Path(f); d = OUT / p.stem; d.mkdir(parents=True, exist_ok=True)
    t = time.time(); r = conv.convert(p); sec = time.time() - t
    doc = r.document
    doc.save_as_markdown(d / f"{p.stem}.md", image_mode=ImageRefMode.REFERENCED, artifacts_dir=pathlib.Path("figures"))
    doc.save_as_json(d / f"{p.stem}.json")
    n = len(doc.pages)
    res.append(dict(file=str(p), pages=n, sec=round(sec, 1), sec_per_page=round(sec / n, 2),
                    peak_rss_mb_cumulative=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20)))
    print(res[-1], flush=True)
    json.dump(res, open(OUT / f"timings_{p.stem}.json", "w"), indent=1)
