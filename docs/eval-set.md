# Generation eval sections

`scripts/eval-golden.json` is the public manifest. `scripts/eval-local.json` is an optional,
gitignored manifest with the same schema, appended after the public entries. No owner textbook
text, PDFs, extracted IR, or private recordings belong in git. The old Bioethics/STAT 350
manifest references have been replaced by the public set below; historical results remain in
`generation-accuracy.md`. Plan step 24 has already removed the old sidecar STAT fixture;
this public set adds no owner textbook content back.

## Public fixtures and license

`tests/fixtures/eval/openstax-statistics.json` contains five short, adapted selections from
*Statistics / Introductory Statistics*, Barbara Illowsky and Susan Dean, OpenStax / Rice
University. Access for free at [OpenStax](https://openstax.org/books/introductory-statistics/pages/1-introduction).
All five selections use [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Prose is condensed, math notation normalized, and exercises, figures and tables omitted.
The IR has only the fields consumed by this harness: `sections`, `id`, `markdown`, and
`passages` (`id`, `markdown`), plus provenance metadata. Passage IDs restart per section.

License verification: read the `md:license` declaration in OpenStax's
[pinned collection source](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/collections/statistics.collection.xml),
which explicitly names Creative Commons Attribution and links `licenses/by/4.0/`.
The [LICENSE at the same revision](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/LICENSE)
also states Attribution 4.0 International.
These fixtures use that revision, not the current 2e web text. Current web pages have changed
license notices; Calculus Volume 1 declares CC BY-NC-SA, so it was not included in this
CC BY set. All five sections come from the verified statistics edition for that reason.
Each source link below is pinned to the exact version used. Attribution and license links
also live in the fixture so they travel with it.

| Section | Source | Expected facts / quantities |
| --- | --- | --- |
| 1.1 Definitions of Statistics, Probability, and Key Terms | [m79593](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/modules/m79593/index.cnxml) | Sample vs population; statistic vs parameter; scores 86, 75, 92 average 84.3; class counts 40, 22, 18 |
| 3.1 Terminology | [m79611](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/modules/m79611/index.cnxml) | Sample space vs event; probabilities in [0, 1]; 0.5 equally likely; fair six-sided die |
| 3.2 Independent and Mutually Exclusive Events | [m79612](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/modules/m79612/index.cnxml) | Independence; replacement gives 4/7; removing blue leaves 3/6 = 1/2 |
| 4.3 Binomial Distribution (Optional) | [m79624](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/modules/m79624/index.cnxml) | Fixed independent trials, two outcomes, constant p, p + q = 1; 30% withdraw and 70% stay; success names measured outcome |
| 6.1 The Standard Normal Distribution | [m79641](https://github.com/openstax/osbooks-statistics/blob/2762445d71879a11499032d004a5b666754ac1c6/modules/m79641/index.cnxml) | Standard normal mean 0, deviation 1; z = (x - mu)/sigma; x = 11, mu = 5, sigma = 2 gives z = 3 |

`expected.facts` and `expected.numbers` are reviewer ground truth for recording/judging,
not a requirement that every generated script mention every item. The existing numeric
gate still checks the generated beats against the source; the optional recorded judge
checks entailment. Fixture validation runs without `TANGENT_EVAL` or model access.

## Add a private dogfooding section

1. Copy the template below to `scripts/eval-local.json` (already ignored).
2. Set `pdf` to the absolute PDF path and `pages` to the inclusive, **1-based PDF page**
   range, not printed textbook page labels. Those two fields are provenance for you;
   the harness does not ingest PDFs or run Docling.
3. Use IR already cached by the app. Set `ir` to its absolute path, a repository-relative
   path under ignored `scripts/eval-local/`, or `appdata:store/<IR filename>.json`.
   Set `section` to the selected section's exact IR ID. If preparing a small local IR,
   retain its section markdown and passage anchors in the fixture shape above.
4. Replace TODO facts with claims the selected pages actually support and add their
   expected numbers. Keep these, the PDF, and local IR on your machine. `detail` is
   optional (`overview`, `standard`, `detailed`, or `complete`). Paths relative to the repo use the repo root.

```json
[
  {
    "name": "STAT 350: TODO section title",
    "pdf": "/TODO/STAT350.pdf",
    "pages": [0, 0],
    "ir": "scripts/eval-local/TODO-stat350-ir.json",
    "section": "TODO-section-id",
    "expected": { "facts": ["TODO: supported facts from selected pages"], "numbers": [] }
  },
  {
    "name": "CS 251: TODO section title",
    "pdf": "/TODO/CS251.pdf",
    "pages": [0, 0],
    "ir": "scripts/eval-local/TODO-cs251-ir.json",
    "section": "TODO-section-id",
    "expected": { "facts": ["TODO: supported facts from selected pages"], "numbers": [] }
  }
]
```

Zero page values are placeholders: replace them before recording. Missing local manifests,
IR files, section IDs and replay recordings print `skip ...` and do not fail CI.
Malformed JSON still fails so typos cannot silently empty the set. To select a different
private manifest, set `TANGENT_EVAL_LOCAL` to its path. For public-only recording, point it
to a nonexistent path so local textbook entries cannot be mixed into the output.

## Replay and recording handoff

Offline checks (no Claude, Docling, TTS, or judge calls):

```sh
bash scripts/heavy.sh node_modules/.bin/vitest run scripts/eval-set scripts/eval-generation --maxWorkers=2
TANGENT_EVAL=1 TANGENT_EVAL_DIR=/tmp/tangent-eval-empty \
  bash scripts/heavy.sh node_modules/.bin/vitest run scripts/eval-generation --maxWorkers=2 --silent=false
```

`tests/fixtures/eval/recordings.json` is the public replay slot, initially `{}`. No model
answers were recorded for this change. Until the coordinator records them, five explicit
recording-miss skips are expected; this is fixture/loader coverage, not generation-accuracy
proof. Actual generation errors in available recordings fail the replay test.

Recordings are keyed by `sha256(model + "\n" + prompt)`, with values
`{ "text": "<exact model response>", "ms": 1234 }`. Replay first loads the public slot,
then overlays private `<TANGENT_EVAL_DIR>/recordings.json`. The private default remains
`~/Library/Application Support/com.tangent.app/eval`, outside the repo. Prompt changes
invalidate exact-key recordings. New answers are only requested with `--record`.

Later, the coordinator may explicitly authorize a model run and record public entries
using `TANGENT_EVAL="--record"`, an empty dedicated `TANGENT_EVAL_DIR`, and a nonexistent
`TANGENT_EVAL_LOCAL`. Review the output and copy **only those public answers** into the
public replay slot. Add `--judge --scenes` if those stages also need recorded coverage.
Never copy the owner's default/private recording store into git. No recording commands
were run as part of this task.
