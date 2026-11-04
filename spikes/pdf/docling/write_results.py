import json, importlib.metadata as md
S = lambda l,f,s,e,c: dict(latex=l, figures=f, sections=s, exercises=e, code_tables=c)
NA = "N/A (nothing to score) is recorded as 0. "
inputs = [
 dict(file="../inputs/stat350_ch5_joint_pmfs.pdf", pages=13, sec=346.9, sec_per_page=26.69, scores=S(3,3,2,4,3),
  notes="Math-heavy substitute (chapter1/index.html is a 1-page TOC; ch1 lectures have 1-3 equations; this is lecture 5.2, Chrome-printed). "
  "LATEX: 10 display equations as valid-looking $$..$$, e.g. '$$p _ { X } ( x ) = \\sum _ { y \\colon p _ { Y } ( y ) > 0 } p _ { X , Y } ( x , y )$$'; \\frac OK ('\\frac { 1 } { 2 4 }'); error: 'supp' read as '\\sup p ( X , Y )'. "
  "INLINE math NOT converted: becomes Unicode math-alphanumerics, duplicated and displaced after the colon: 'denoted by , ... equals some value simultaneously: 𝑋 𝑌 𝑝𝑋,𝑌 𝑋 𝑥 𝑌 𝑦'. 'for 3 random variables' sentence lost its symbols. Tokens space-separated, digits split ('2 4'). "
  "FIGURES: 14 pictures extracted vs 4 <figure> in HTML (plus banner/logos/icons); only 3/14 have captions attached; 'Fig. 5.4 ...' caption emitted as a text line next to the image. "
  "SECTIONS: HTML has levels 1-4 (19 headings); Docling found all but emitted ALL 38 headers at level 1 (flat '##'), also promoting 'Example', 'Solution', 'Exercise N' to headings. "
  "EXERCISES: '5.2.5. Exercises' and '5.2.6. Additional Practice Problems' headed, 'Exercise N'/'Solution' sub-headers present; practice items as '- [ ] Ⓣ or Ⓕ' checkboxes. Identifiable via headings, not a structured block. "
  "TABLES: 9 tables; fractions as '1 29'; column headers prefixed with table caption ('...two dice constraining each other - 1'); 2 tables dropped 115/125 cells (MatchingPostProcessor warning)."),
 dict(file="../inputs/stat350_ch1.pdf", pages=1, sec=91.0, sec_per_page=90.98, scores=S(0,2,2,0,0),
  notes=NA + "1-page TOC (chapter1/index.html). 91 s is dominated by first-run model download/load (not representative). Headings '1. Introduction to Statistics' and 'Lectures' both level 1 (real: h1/h2); 2 pictures extracted (banner/logo), 0 captions; lecture links preserved as list items. Used only as a sanity check."),
 dict(file="../inputs/cs250/ch-2_cs250_txtbook.pdf", page_range="1-40 of 239", pages=40, sec=525.5, sec_per_page=13.14, scores=S(2,1,2,2,3),
  notes="PAGES 1-40 ONLY (full 239 pages killed after ~45 min in an earlier run with OCR on; rerun used do_ocr=False). Sections 2.1-2.4 only; end-of-chapter exercises NOT verified. zyBooks PDF with per-page watermark 'zyBooks <date> <student id> name' ('©zyBooks' x72 in md) injected into body text and table cells. "
  "LATEX: 6 formulas; '$$f = ( g + h ) - ( i + j ) ;$$' fine, but 'x' for \\times and one broken '$$\\begin{array} {$$' (line 1129); two's-complement sums mostly OK '( 1 \\times - 2 ^ { 6 3 } )'. "
  "FIGURES: 38 pictures, 0 with attached captions; the one real captioned figure 'Figure 2.3.1: Memory addresses...' is a text line directly above the image (detached). Most pictures are zyBooks animation frames. "
  "SECTIONS: '2.1 Introduction'... '2.4 Signed and unsigned numbers' found with correct pages, but all 74 headers level 1, mixed with 'PARTICIPATION ACTIVITY' x~20, 'Animation captions:', 'Show answer', 'Reset'; '2.2 Operations ... ©zyBooks 09/01/26 ... Moni' has the watermark glued into the title. "
  "EXERCISES: 'PARTICIPATION ACTIVITY'/'CHALLENGE ACTIVITY' headers identify each activity (103 unchecked-checkbox items) but no grouping, and answers/'Show answer' interleaved. "
  "CODE/TABLES: 8 fences; 'ADD a, b, c // The sum...' good but indentation ragged and one nested/broken fence run (lines 378-396); tables 6, LEGv8 instruction table preserved as markdown but 'fl�ags'-style ligature loss ('add and set �ags') and watermark text inside cells."),
 dict(file="../inputs/cs250/ch-1_cs250_txtbook.pdf", page_range="1-25 of 117", pages=25, sec=370.3, sec_per_page=14.81, scores=S(0,2,2,2,3),
  notes=NA + "PAGES 1-25 ONLY; lightly inspected. 30 pictures, 4 with captions ('Figure 1.1.1: Personal computers...' as text, others detached). 41 level-1 headers incl. '1.1 Introduction', '1.2 Seven great ideas...' (right) mixed with 'PARTICIPATION ACTIVITY'. C listing 'swap(int v[], int k)' fenced OK; 2 tables. No equations in this range (latex unscored)."),
 dict(file="../inputs/cs250/cs-3_cs250_txtbook.pdf", page_range="1-25 of 125", pages=25, sec=59.7, sec_per_page=2.39, scores=S(0,1,2,2,3),
  notes=NA + "PAGES 1-25 ONLY; lightly inspected. 20 pictures, 0 captions. 45 level-1 headers (3.1-3.3 right, plus activity noise; 'Over�ow' ligature loss). 9 tables, e.g. overflow table preserved cleanly '| A + B | ≥ 0 | ≥ 0 | < 0 |'. 0 formulas emitted in this range (binary arithmetic rendered as text/pictures; not verified against the PDF)."),
 dict(file="../inputs/cs250/ch-4_cs250_txtbook.pdf", page_range="1-25 of 243", pages=25, sec=2.8, sec_per_page=0.11, scores=S(0,1,2,2,0),
  notes=NA + "PAGES 1-25 ONLY; lightly inspected. 2.8 s is warm-model time with nothing to enrich (0 code, 0 formulas, 0 tables): shows base layout cost ~0.1 s/page; enrichment dominates. Datapath figures (19 pictures, 0 captions attached); 'Figure 4.1.2: ...' caption is mis-labelled as a section_header, 'Figure 4.1.1' as a list item. Sections 4.1-4.3 right but flat. ('�gure' ligature loss.)"),
]
json.dump(dict(tool="docling", version=md.version("docling"),
  options=dict(pipeline="PdfPipelineOptions", do_formula_enrichment=True, do_code_enrichment=True, generate_picture_images=True, images_scale=2.0, do_ocr=False, do_table_structure="default (True)", accelerator="default AUTO", export="markdown ImageRefMode.REFERENCED + JSON"),
  env=dict(machine="M4 Max 36GB", python="3.12", torch=md.version("torch"), models="CodeFormulaV2 610MB + docling-layout-heron 164MB + docling-models(tableformer) 342MB = ~1.1GB, auto-downloaded from HF on first run"),
  peak_rss_mb="~3.9 GB (process-wide max across the whole run, ru_maxrss; cumulative)", inputs=inputs), open("out/results.json", "w"), indent=1, ensure_ascii=False)
