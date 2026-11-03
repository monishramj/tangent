import re, sys, glob, json, pypdfium2 as p
res = {}
for f in ["ch-1_cs250_txtbook","ch-2_cs250_txtbook","cs-3_cs250_txtbook","ch-4_cs250_txtbook","stat350_ch5_joint_pmfs"]:
    pdf = f"../inputs/cs250/{f}.pdf" if "cs250" in f else f"../inputs/{f}.pdf"
    d = p.PdfDocument(pdf); n = len(d)
    txt = [d[i].get_textpage().get_text_range() for i in range(n)]
    md = open(f"out/{f}/{f}/{f}.md").read()
    real = []
    for t in txt:
        for l in t.splitlines():
            m = re.match(r"^\s*(\d+\.\d+)\s+[A-Z][A-Za-z ,/&\-]{3,60}$", l)
            if m and l.strip() not in real: real.append(l.strip())
    mdh = re.findall(r"^(#+)\s*(.*)$", md, re.M)
    mdnum = [(len(h), re.sub(r"[*]", "", t).strip()) for h, t in mdh if re.match(r"\**\d+\.\d+", t.strip("* "))]
    numsec = {re.match(r"(\d+\.\d+)", t).group(1) for _, t in mdnum}
    realn = {re.match(r"(\d+\.\d+)", r).group(1) for r in real}
    figs_pdf = sum(len(re.findall(r"(?mi)^\s*(?:figure|fig\.)\s*\d+\.\d+", t)) for t in txt)
    caps_md = len(re.findall(r"(?mi)^\W*(?:figure|fig\.)\s*\d+[\.\d]*", md))
    imgs = len(glob.glob(f"out/{f}/{f}/*.jpeg"))
    ex = [l[:80] for l in md.splitlines() if re.search(r"(?i)exercise|challenge activity|practice problem", l) and l.startswith("#")]
    res[f] = dict(pages=n, md_lines=md.count("\n"), headings=len(mdh), md_numbered_h=len(mdnum), real_numbered=len(real),
      real_not_in_md=sorted(realn-numsec)[:15], md_not_real=sorted(numsec-realn)[:15], fig_labels_pdf=figs_pdf, fig_labels_md=caps_md,
      img_refs=len(re.findall(r"!\[", md)), img_files=imgs, table_rows=len(re.findall(r"(?m)^\|", md)), fences=md.count("```"),
      dollar=md.count("$"), ex_headings=len(ex), ex_sample=ex[:4], levels={l: sum(1 for h,_ in mdh if len(h)==l) for l in range(1,7)})
print(json.dumps(res, indent=1))
