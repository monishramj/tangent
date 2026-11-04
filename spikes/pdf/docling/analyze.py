import sys, json, collections
d = json.load(open(sys.argv[1]))
t = d["texts"]; c = collections.Counter(x["label"] for x in t)
print(dict(c)); print("pictures", len(d["pictures"]), "w/caption", sum(1 for p in d["pictures"] if p.get("captions")), "tables", len(d["tables"]), "tables w/caption", sum(1 for p in d["tables"] if p.get("captions")))
lv = collections.Counter(x.get("level") for x in t if x["label"] == "section_header"); print("header levels", dict(lv))
if len(sys.argv) > 2:
    for x in t:
        if x["label"] == "section_header": print(x.get("level"), x["text"][:80], "| p", x["prov"][0]["page_no"])
