from PIL import Image

from tangent_sidecar.postprocess import postprocess


def node(title, level=1, md="", figures=(), pages=(1,), **kw):
    return {"id": f"s-{title}", "title": title, "level": level, "markdown": md,
            "figures": list(figures), "exercises": [], "anchors": [{"page": p} for p in pages],
            "children": [], **kw}


def flat(nodes):
    for n in nodes:
        yield n
        yield from flat(n["children"])


def png(path, size, color):
    Image.new("RGB", size, color).save(path)
    return str(path)


def fig(i, path, caption=""):
    return {"id": f"figure-{i}", "caption": caption, "image_path": str(path)}


def test_levels_from_numbering_and_words():
    ir = {"sections": [node("Chapter 5 Probability"), node("5.1 Basics"), node("5.1.2 Deep"),
                       node("5.2 More"), node("Section Overview"), node("Loose heading")]}
    out = postprocess(ir)["sections"]
    levels = {n["title"]: n["level"] for n in flat(out)}
    assert levels["Chapter 5 Probability"] == 1 and levels["5.1 Basics"] == 2
    assert levels["5.1.2 Deep"] == 3 and levels["5.2 More"] == 2 and levels["Section Overview"] == 2
    assert [c["title"] for c in out[0]["children"]][0] == "5.1 Basics"
    assert levels["Loose heading"] == 3  # unnumbered nests under last dotted heading (5.2)


def test_font_size_hint():
    ir = {"sections": [node("Big", font_size=20), node("Small", font_size=12), node("Big2", font_size=20)]}
    levels = [n["level"] for n in flat(postprocess(ir)["sections"])]
    assert levels == [1, 2, 1]


def test_activity_headings_demoted_into_content():
    a = node("5.1 Basics", md="intro")
    b = node("PARTICIPATION ACTIVITY", md="Q1", pages=(2,))
    b["exercises"] = [{"id": "e", "markdown": "Q1", "anchors": []}]
    c = node("Example 4.2", md="worked")
    out = postprocess({"sections": [a, b, c, node("5.2 Next")]})["sections"]
    titles = [n["title"] for n in flat(out)]
    assert titles == ["5.1 Basics", "5.2 Next"]
    s = out[0]
    assert "**PARTICIPATION ACTIVITY**" in s["markdown"] and "worked" in s["markdown"]
    assert s["activities"] == ["PARTICIPATION ACTIVITY", "Example 4.2"]
    assert len(s["exercises"]) == 1 and {"page": 2} in s["anchors"]


def test_figure_filtering(tmp_path):
    frames = [fig(i, png(tmp_path / f"f{i}.png", (200, 100), "white")) for i in range(1, 5)]
    tiny = fig(5, png(tmp_path / "tiny.png", (8, 8), "black"))
    real = fig(6, png(tmp_path / "real.png", (200, 100), "red"), caption="Figure 1: x")
    allf = frames + [tiny, real]
    md = "\n\n".join(f"![{f['caption']}](file://{f['image_path']})" for f in allf)
    out = postprocess({"sections": [node("1 A", md=md, figures=allf)]})["sections"][0]
    assert [f["id"] for f in out["figures"]] == ["figure-1", "figure-6"]
    assert "tiny.png" not in out["markdown"] and "f2.png" not in out["markdown"]
    assert "real.png" in out["markdown"]


def test_caption_reattached(tmp_path):
    f = fig(1, png(tmp_path / "a.png", (200, 100), "blue"))
    md = f"intro\n\n![](file://{f['image_path']})\n\nFigure 4.12 A heap.\n\nbody"
    out = postprocess({"sections": [node("1 A", md=md, figures=[f])]})["sections"][0]
    assert out["figures"][0]["caption"] == "Figure 4.12 A heap."
    assert "![Figure 4.12 A heap.](" in out["markdown"]
    assert out["markdown"].count("Figure 4.12") == 1 and "body" in out["markdown"]


def test_ligatures():
    md = "The �le is e�cient, the e�ect ﬁnal ﬂow q�x"
    out = postprocess({"sections": [node("1 A", md=md)]})["sections"][0]["markdown"]
    assert out == "The file is efficient, the effect final flow q�x"


def test_inline_math_collapse():
    md = "Let \U0001d44b \U0001d44c be rvs with sum \U0001d44b \U0001d44c done"
    out = postprocess({"sections": [node("1 A", md="Let be rvs \U0001d44b \U0001d44c \U0001d44b \U0001d44c ok"),
                                    node("2 B", md="plain")]})["sections"]
    assert out[0]["markdown"] == "Let be rvs \U0001d44b \U0001d44c ok"
    assert out[0]["needs_math_check"] is True
    assert "needs_math_check" not in out[1]


WATERMARK = "©zyBooks 01/15/26 14:03 EST 1234567 Jane Q Student PURDUECS250Fall2026"


def test_watermarks_and_footers_stripped_before_text_leaves_sidecar():
    from tangent_sidecar.ingest import section_text
    md = f"Muxes pick one input.\n\n{WATERMARK}\n\nThe ALU adds. {WATERMARK}\n\n*01/15/26 14:03 1234567 Jane Q Student*\n\nCopyright 2026 Publisher.\n\nDone."
    ir = {"sections": [node("4.1 Datapath", md=md)]}
    for text in (postprocess(ir)["sections"][0]["markdown"], section_text(ir, "s-4.1 Datapath")):
        assert "Jane" not in text and "1234567" not in text and "zyBooks" not in text and "Copyright" not in text
        assert "Muxes pick one input." in text and "The ALU adds." in text and "Done." in text


def test_promoted_caption_and_watermark_are_content_not_sections():
    ir = {"sections": [node("4.1 Introduction"), node("Implementation"),
                       node("How to use this tool \ue5cf", md="Help"),
                       node("Figure 4.1.2: The datapath. " + WATERMARK, md="Explanation", pages=(2,)),
                       node(WATERMARK, md="Retained body", pages=(3,)),
                       node("4.2 Logic design conventions", pages=(4,))]}
    out = postprocess(ir)["sections"]
    assert [n["title"] for n in flat(out)] == ["4.1 Introduction", "Implementation", "4.2 Logic design conventions"]
    text = out[0]["children"][0]["markdown"]
    assert "Figure 4.1.2: The datapath." in text and "Explanation" in text and "Retained body" in text
    assert "zyBooks" not in str(out) and "Jane" not in str(out)
    assert out[0]["anchors"] == [{"page": 1}, {"page": 2}, {"page": 3}]


def test_new_chapter_resets_last_numbered_section():
    out = postprocess({"sections": [node("4.1 Intro"), node("Chapter 5"), node("Overview")]})["sections"]
    assert [n["level"] for n in flat(out)] == [2, 1, 1]


def test_roman_letter_nesting():
    ir = {"sections": [node("A. Alone"), node("I. INTRO"), node("A. Data"), node("B. More"), node("II. APPROACH"),
                       node("A. Again")]}
    assert [n["level"] for n in flat(postprocess(ir)["sections"])] == [1, 1, 2, 2, 1, 2]


def test_outline_skeleton(monkeypatch):
    from tangent_sidecar import postprocess as pp
    monkeypatch.setattr(pp, "pdf_outline", lambda p: [(1, "Part One", 2), (2, "Chapter 1: Start", 2),
                                                      (2, "Chapter 2", 5)])
    ir = {"sections": [node("chapter 1 start", pages=(2,)), node("Sub topic", pages=(3,)),
                       node("Another", pages=(4,)), node("Chapter 2", pages=(5,)), node("Deep", pages=(6,))]}
    out = postprocess(ir, "x.pdf")["sections"]
    assert [(n["title"], n["level"]) for n in flat(out)] == [
        ("Part One", 1), ("chapter 1 start", 2), ("Sub topic", 3), ("Another", 3), ("Chapter 2", 2), ("Deep", 3)]
    assert len(out) == 1 and len(out[0]["children"]) == 2


def test_cached_flat_book_repair_preserves_content_and_generation_scopes(monkeypatch):
    import copy
    from tangent_sidecar import postprocess as pp
    from tangent_sidecar.ingest import repair_sections, section_text, list_sections
    monkeypatch.setattr(pp, "pdf_outline", lambda p: [(1, "Contents", 1), (1, "Part 1", 3),
                                                      (2, "Chapter 1 Ethics", 3), (2, "Chapter 2 Consent", 6)])
    ir = {"sections": [node("CONTENTS", pages=(1,), md="table"),
                       node("Chapter 2", pages=(1,)), node("Consent 6", pages=(2,), md="toc row"),
                       node("Ethics", pages=(3,), md="chapter one"), node("Autonomy", pages=(4,), md="autonomy text"),
                       node("The report concurs:", pages=(4,), md="quotation"),
                       node("Consent", pages=(6,), md="chapter two"),
                       node("A Reading", pages=(7,)), node("JANE DOE", pages=(7,), md="article text")]}
    original = copy.deepcopy(ir)
    out = repair_sections({"ir": ir, "path": "book.pdf"})
    assert ir == original
    rows = list_sections({"ir": out})
    assert [(s["title"], s["level"]) for s in rows] == [
        ("CONTENTS", 1), ("Part 1", 1), ("Ethics", 2), ("Autonomy", 3), ("Consent", 2), ("A Reading", 3)]
    assert out["outline_version"] == 1
    assert "toc row" in section_text(out, "s-CONTENTS")
    assert "quotation" in section_text(out, "s-Autonomy")
    assert "article text" in section_text(out, "s-A Reading")
    assert "chapter two" not in section_text(out, "s-Ethics")
    all_text = "\n".join(n["markdown"] for n in flat(out["sections"]))
    for text in ["table", "toc row", "chapter one", "autonomy text", "quotation", "chapter two", "article text"]:
        assert all_text.count(text) == 1
    assert [s["id"] for s in rows if not s["id"].startswith("outline-")] == [
        "s-CONTENTS", "s-Ethics", "s-Autonomy", "s-Consent", "s-A Reading"]


def test_outline_upgrade_leaves_existing_tree_intact(monkeypatch):
    from tangent_sidecar import postprocess as pp
    from tangent_sidecar.ingest import repair_sections
    monkeypatch.setattr(pp, "pdf_outline", lambda p: [(1, "Chapter", 1)])
    parent = node("Chapter", md="body")
    parent["children"] = [node("Nested", level=2, md="nested body")]
    ir = {"sections": [parent]}
    assert repair_sections({"ir": ir, "path": "book.pdf"}) == {**ir, "outline_version": 1}
