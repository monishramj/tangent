import json
import sys
from typing import Any, NotRequired, TypedDict

from .tts import tts_align
from .ingest import ingest_pdf, pdf_info, original_pdf, list_sections, section_text


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
            "section_text": section_text, "pdf_info": pdf_info, "original_pdf": original_pdf}


def handle(req: Request) -> Response:
    fn = HANDLERS.get(req.get("method"))
    if fn is None:
        return {"id": req.get("id"), "error": f"unknown method: {req.get('method')}"}
    try:
        return {"id": req["id"], "result": fn(req.get("params", {}))}
    except Exception as e:
        return {"id": req.get("id"), "error": str(e)}


def main() -> None:
    for line in sys.stdin:
        try:
            res = handle(json.loads(line))
        except Exception as e:
            print(f"bad line: {e}", file=sys.stderr)
            res = {"id": None, "error": f"malformed request: {e}"}
        print(json.dumps(res), flush=True)
