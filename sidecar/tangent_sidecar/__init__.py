import json
import sys
from typing import Any, NotRequired, TypedDict

from .limits import apply_limits, start_watchdog
from .tts import tts_align
from .ingest import ingest_pdf, pdf_info, list_sections, section_text, repair_sections, enrich_formulas


class Request(TypedDict):
    id: int
    method: str
    params: dict[str, Any]


class Response(TypedDict):
    id: int | None
    result: NotRequired[Any]
    error: NotRequired[str]


HANDLERS = {"ping": lambda params: "pong", "tts_align": tts_align,
            "ingest_pdf": ingest_pdf, "list_sections": list_sections,
            "section_text": section_text, "repair_sections": repair_sections, "pdf_info": pdf_info,
            "enrich_formulas": enrich_formulas}


def handle(req: Request, progress=None) -> Response:
    fn = HANDLERS.get(req.get("method"))
    if fn is None:
        return {"id": req.get("id"), "error": f"unknown method: {req.get('method')}"}
    try:
        result = (fn(req.get("params", {}), progress=progress)
                  if req.get("method") == "ingest_pdf" and progress else fn(req.get("params", {})))
        return {"id": req["id"], "result": result}
    except Exception as e:
        return {"id": req.get("id"), "error": str(e)}


def main() -> None:
    apply_limits()
    start_watchdog()
    for line in sys.stdin:
        try:
            req = json.loads(line)
            output = sys.stdout  # ingest redirects model diagnostics to stderr
            def progress(value):
                print(json.dumps({"id": req["id"], "progress": value}), file=output, flush=True)
            res = handle(req, progress=progress)
        except Exception as e:
            print(f"bad line: {e}", file=sys.stderr)
            res = {"id": None, "error": f"malformed request: {e}"}
        print(json.dumps(res), flush=True)
