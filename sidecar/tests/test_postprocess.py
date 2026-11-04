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
