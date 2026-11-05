"""Deterministic IR cleanup after Docling: heading levels, figures, ligatures, inline math."""

import re
import unicodedata
from pathlib import Path

NON_STRUCTURAL = re.compile(
    r"(solutions?|answers?|participation activity|challenge activity|animation|try it|how to use this tool|example|examples)(\s+[\d.]+)?:?", re.I)
NUMBERED = re.compile(r"\s*(?:(?:chapter|section)\s+)?(\d{1,3}(?:\.\d{1,3})*)\.?(?:\s|:|$)", re.I)
# Dotted numbers (5.2.1) are real headings; "1. Foo" is a list item Docling promoted.
DOTTED = re.compile(r"\s*\d{1,3}(?:\.\d{1,3})+\.?(?:\s|:|$)")
ROMAN = re.compile(r"\s*[IVX]+\.\s+\S")
LETTER = re.compile(r"\s*[A-Z]\.\s+\S")
JUNK = re.compile("[\ue000-\uf8ff\U000f0000-\U0010ffff\U0001f300-\U0001faff\u2600-\u27bf\ufe0f\u200d]")
CAPTION = re.compile(r"(?:figure|fig\.?)\s*\d", re.I)
# ponytail: tiny wordlist; point at a real dictionary if more U+FFFD ligatures need fixing.
WORDS = set("""file files first final find field fine fit five flow flows flat float flag flip fleet
efficient effect effects effective efficiency different difference diff offer office official affect
afford suffix suffice suffices sufficient coefficient coefficients definition define defined
specific specified classification classify certificate conflict influence inflate flexible fluid
fixed fix figure figures fill finite finish confirm reflect reflection benefit benefits shuffle
buffer buffers traffic staff stuff off offset effort left life""".split())
MATH = "[\U0001d400-\U0001d7ffΑ-ω∀-⋿℀-⅏]"
DUP_MATH = re.compile(rf"(?P<g>{MATH}+(?:[ ]{MATH}+)*)[ ]+(?P=g)")


def _level(n, prev, sizes):
    m = NUMBERED.match(n["title"])
    if m:
        return m[1].count(".") + 1
    low = n["title"].lower()
    if low.startswith("chapter"):
        return 1
    if low.startswith("section"):
        return 2
    if "font_size" in n and n["font_size"] in sizes:
        return sizes.index(n["font_size"]) + 1
    return min(n["level"], prev + 1) if prev else n["level"]


def _fix_ligatures(text):
    text = "".join(unicodedata.normalize("NFKC", c) if "ﬀ" <= c <= "ﬆ" else c for c in text)

    def word(m):
        hits = {c for c in ("fi", "fl", "ff", "ffi", "ffl")
                if m[0].replace("�", c).lower() in WORDS}
        return m[0].replace("�", hits.pop()) if len(hits) == 1 else m[0]
    return re.sub(r"\w*�\w*", word, text)


def _figures(sec):
    figs, keep, prev = sec["figures"], [], None
    from PIL import Image  # already a Docling dependency

    def thumb(path):
        try:
            with Image.open(path) as im:
                return im.size, list(im.convert("L").resize((16, 16)).getdata())
        except OSError:
            return None, None
    drop = []
    for f in figs:
        size, px = thumb(f["image_path"])
        tiny = size is not None and min(size) < 32
        same = (prev is not None and px is not None and not f["caption"]
                and sum(abs(a - b) for a, b in zip(px, prev)) / 256 < 4)
        prev = px
        if (tiny and not f["caption"]) or same:
            drop.append(f)
        else:
            keep.append(f)
    for f in drop:
        uri = Path(f["image_path"]).as_uri()
        sec["markdown"] = "\n\n".join(p for p in sec["markdown"].split("\n\n") if uri not in p)
    sec["figures"] = keep
    # reattach detached captions to the nearest preceding captionless figure
    paras, last, out = sec["markdown"].split("\n\n"), None, []
    by_uri = {Path(f["image_path"]).as_uri(): f for f in keep}
    for p in paras:
        for uri, f in by_uri.items():
            if p.startswith("![") and f"]({uri})" in p:
                last = (f, len(out))
        if last and CAPTION.match(p) and not last[0]["caption"]:
            f, i = last
            f["caption"] = p.strip()
            out[i] = re.sub(r"^!\[[^\]]*\]", f"![{f['caption']}]", out[i])
            last = None
            continue
        out.append(p)
    sec["markdown"] = "\n\n".join(out)


# Watermark/footer stripping must run before any text can reach a model (see src/gen/sanitize.ts).
_ZYBOOKS = re.compile(r"©\s*zyBooks.*$", re.I)  # ©zyBooks MM/DD/YY HH:MM EDT <id> <name> <COURSE+TERM>
_STAMP = re.compile(r"\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}.*\d{6,}.*$")
_FOOTER = re.compile(r"^[\s*_>|]*(?:©|\(c\)\s|copyright\b).{0,160}$", re.I)
_MARKUP_ONLY = re.compile(r"^[\s*_>|]*$")


def strip_footers(markdown):
    out = []
    for line in markdown.split("\n"):
        if _FOOTER.match(line):
            continue
        cut = _STAMP.sub("", _ZYBOOKS.sub("", line))
        if cut != line and _MARKUP_ONLY.match(cut):
            continue
        out.append(cut)
    return "\n".join(out)


def _clean(n):
    n["title"] = " ".join(strip_footers(JUNK.sub("", n["title"])).split())
    n["markdown"] = strip_footers(JUNK.sub("", n["markdown"]))


def _norm(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def pdf_outline(pdf_path):
    """[(depth, title, page)] from the PDF's embedded outline, [] if none."""
    try:
        import pypdfium2
        pdf = pypdfium2.PdfDocument(str(pdf_path))
        try:
            return [(t.level + 1, t.title, t.page_index + 1) for t in pdf.get_toc() if t.page_index is not None]
        finally:
            pdf.close()
    except Exception:
        return []


def _pdf_font_sizes(pdf_path, nodes):
    """Set n["font_size"] from the heading's first glyph on its anchor page."""
    try:
        import pypdfium2
        import pypdfium2.raw as raw
        pdf = pypdfium2.PdfDocument(str(pdf_path))
    except Exception:
        return
    try:
        for n in nodes:
            if not n["anchors"] or NUMBERED.match(n["title"]):
                continue
            try:
                tp = pdf[n["anchors"][0]["page"] - 1].get_textpage()
                hit = tp.search(n["title"]).get_next()
                if hit:
                    n["font_size"] = round(raw.FPDFText_GetFontSize(tp, hit[0]) * 2) / 2
            except Exception:
                pass
    finally:
        pdf.close()


def _apply_outline(kept, outline):
    """Outline depth defines top levels; other headings nest under the latest outline entry."""
    pages = [a["page"] for n in kept for a in n["anchors"]]
    lo, hi = (min(pages), max(pages)) if pages else (0, 0)
    pos, last, out_ids = 0, None, set()
    for depth, title, page in outline:
        if not lo <= page <= hi:
            continue
        cands = [i for i in range(pos, len(kept)) if kept[i]["level"] > 0 and _norm(kept[i]["title"]) == _norm(title)]
        i = next((i for i in cands if any(a["page"] == page for a in kept[i]["anchors"])), cands[0] if cands else None)
        if i is None:
            i = next((i for i in range(pos, len(kept)) if kept[i]["anchors"] and kept[i]["anchors"][0]["page"] >= page),
                     len(kept))
            kept.insert(i, {"id": f"outline-{len(out_ids) + 1}", "title": title, "level": depth, "markdown": "",
                            "figures": [], "exercises": [], "anchors": [{"page": page}], "children": []})
        kept[i]["level"] = depth
        out_ids.add(id(kept[i]))
        pos = i + 1
    for n in kept:
        if id(n) in out_ids:
            last = n
        elif last and n["level"] > 0:
            n["level"] += last["level"]


def postprocess(ir, pdf_path=None):
    flat = []

    def walk(nodes):
        for n in nodes:
            flat.append(n)
            walk(n["children"])
            n["children"] = []
            _clean(n)
    walk(ir["sections"])
    outline = pdf_outline(pdf_path) if pdf_path else []
    if pdf_path and not outline and not any(DOTTED.match(n["title"]) for n in flat):
        _pdf_font_sizes(pdf_path, [n for n in flat if n["level"] > 0])
    sizes = sorted({n["font_size"] for n in flat if "font_size" in n and not NUMBERED.match(n["title"])},
                   reverse=True)
    kept, roots, stack = [], [], []
    roman = None  # most recent "IV. FOO" heading; "A. Foo" nests under it
    numbered = None  # most recent dotted heading; unnumbered ones nest beneath it
    for n in flat:
        if n["level"] > 0 and kept and (not n["title"] or CAPTION.match(n["title"])
                                            or NON_STRUCTURAL.fullmatch(n["title"])):
            host = kept[-1]
            if n["title"]:
                host["markdown"] += ("\n\n" if host["markdown"] else "") + f"**{n['title']}**"
            if n["markdown"]:
                host["markdown"] += "\n\n" + n["markdown"]
            host["figures"] += n["figures"]
            host["exercises"] += n["exercises"]
            host.setdefault("activities", []).append(n["title"].strip())
            pages = {a["page"] for a in host["anchors"] + n["anchors"]}
            host["anchors"] = [{"page": p} for p in sorted(pages)]
            continue
        if n["level"] > 0:
            n["level"] = _level(n, kept[-1]["level"] if kept else 0, sizes)
            if ROMAN.match(n["title"]):
                n["level"] = 1
                roman = n
            elif roman and LETTER.match(n["title"]):
                n["level"] = roman["level"] + 1
            elif DOTTED.match(n["title"]):
                numbered = n
            elif re.match(r"chapter\b", n["title"], re.I):
                numbered = None
            elif numbered and not re.match(r"(chapter|section)\b", n["title"], re.I):
                n["level"] = numbered["level"] + 1
        kept.append(n)
    if outline:
        _apply_outline(kept, outline)
    for n in kept:
        while stack and stack[-1]["level"] >= n["level"]:
            stack.pop()
        (stack[-1]["children"] if stack else roots).append(n)
        stack.append(n)
        _figures(n)
        n["markdown"] = _fix_ligatures(n["markdown"])
        n["markdown"], hits = DUP_MATH.subn(r"\g<g>", n["markdown"])
        if hits:
            n["needs_math_check"] = True
    # Reparenting changes page spans too; propagate only after the final tree exists.
    for n in reversed(kept):
        n["anchors"] = [{"page": p} for p in sorted(
            {a["page"] for s in [n, *n["children"]] for a in s["anchors"]})]
    return {**ir, "sections": roots}
