"""Deterministic IR cleanup after Docling: heading levels, figures, ligatures, inline math."""

import re
import unicodedata
from pathlib import Path

NON_STRUCTURAL = re.compile(
    r"(participation activity|challenge activity|animation|try it|example|examples)(\s+[\d.]+)?:?", re.I)
NUMBERED = re.compile(r"\s*(?:(?:chapter|section)\s+)?(\d{1,3}(?:\.\d{1,3})*)\.?(?:\s|:|$)", re.I)
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


def postprocess(ir):
    flat = []

    def walk(nodes):
        for n in nodes:
            flat.append(n)
            walk(n["children"])
            n["children"] = []
    walk(ir["sections"])
    sizes = sorted({n["font_size"] for n in flat if "font_size" in n and not NUMBERED.match(n["title"])},
                   reverse=True)
    kept, roots, stack = [], [], []
    for n in flat:
        if n["level"] > 0 and kept and NON_STRUCTURAL.fullmatch(n["title"].strip()):
            host = kept[-1]
            host["markdown"] += ("\n\n" if host["markdown"] else "") + f"**{n['title'].strip()}**"
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
        kept.append(n)
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
    return {**ir, "sections": roots}
