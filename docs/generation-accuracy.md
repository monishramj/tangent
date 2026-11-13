# Generation accuracy and speed

Audit of the generation pipeline against principle 7 ("never teach something wrong") and principle 6 ("feels
real-time"), with a research summary and a ranked plan. Date: 2026-11-12. Line numbers are for the commit that adds
this doc.

## 1. Pipeline as it is

```
IR section (Docling, passages [pN] with page boxes)
  └─ script: ONE sonnet call for the whole section            src/gen/script.ts:139
       checks: zod shape, speech linter, (new) number grounding
       retry: (new) targeted repair of the broken beats only
  └─ chunkBeats(3, then 4)                                    src/pipeline/streamVideo.ts:179
  └─ per scene, 3 in parallel, lookahead 3:
       mathToSpeech → TTS + MMS_FA alignment → scene (haiku, templates)  streamVideo.ts:93-118
       checks: TemplateScene zod, checkTemplateScene, (new) on-screen numbers, expandTemplates, validateScene
       computed visuals: array/tree/stack/queue/graph ops, matrix, distribution, pictograph % (packages/motion/src/dsl)
  └─ checkpoints: one haiku side call                         streamVideo.ts:183, src/gen/checkpoints.ts
  └─ tutor: keyword retrieval (top-4 paragraphs) + haiku     src/tutor/tutor.ts:68, src/tutor/retrieve.ts
```

What is already good: computed visuals (algorithm states, matrix products, distribution areas, pictograph
percentages are code, not model output); prompt-injection hygiene (`sanitize.ts`: neutralised data blocks, rule before
and reminder after); a deterministic speech linter; the scene model must copy `say` verbatim
(`scene.ts:checkTemplateScene`), so the scene stage cannot change what is spoken; checkpoint cards are rejected when
they reference data the card does not show (`checkpoints.ts:needsMissingData`); the tutor is told to say when the
section does not cover a question.

## 2. Concrete risks (found in the audit)

Ranked by how likely they are to put a wrong fact in front of a student.

| # | Risk | Where | Status |
|---|------|-------|--------|
| R1 | **The script prompt asked for invented facts.** "Open with a hook: a surprising fact, a bold claim or a question" with no source constraint. A Code Report-style hook is exactly where a model reaches for an outside statistic. | old `script.ts:72` | Fixed: the hook must come from the section (`script.ts:84`). |
| R2 | **No grounding check at all on the script.** The only accuracy instruction was one line ("Do not add claims the section does not make"); `cite` is optional, never checked and never used downstream; `passages` ids are only filtered for validity. Nothing verified that a beat says what its source says. | old `script.ts:86`, `:123-131` | Partly fixed: numeric claims are now checked deterministically (`checkGrounding`, `script.ts:62`). Non-numeric claims are still unchecked (plan item P4). |
| R3 | **The scene model can invent on-screen numbers.** `stat`, `chart`, `gauge`, `pictograph`, `table`, `timeline` and `distribution` all take numbers from the haiku answer; the scene model only sees `say` + `visualIntent`, never the source, so "show a stat" invites a made-up one. These numbers are shown, not spoken, so no other check sees them. | `scene.ts:89`, `templates.ts:391` | Fixed: on-screen numbers must be spoken in the scene or stated in the source (`checkTemplateScene`, `scene.ts:29`). |
| R4 | **A script retry regenerates the whole script.** One parenthetical or 23-word sentence cost a second full sonnet call (the entire time-to-first-frame again, ~1-2 min). | old `script.ts:123-131` | Fixed: targeted repair of only the broken beats (`script.ts:158`). |
| R5 | **The script fails closed for the whole video.** Any remaining violation (style or accuracy) throws "Invalid script" and the student gets nothing. | `streamVideo.ts:176` | Partly fixed: beats that still carry an unsupported number are cut (at most a quarter of the script). Style violations still fail the video (plan P7). |
| R6 | **Checkpoints see visual intents, not narration.** `scenes: groups.map(g => g.plan.concept)` and `concept` is the first beat's `visualIntent` (`plan.ts:29`). Questions are aligned to what the animation was meant to show, and the generated MCQ `answer` is never checked against the source; `sectionMarkdown.slice(0, 20000)` silently truncates long sections. | `streamVideo.ts:183`, `checkpoints.ts:102` | Open (P3). |
| R7 | **Scene failure drops content silently.** A scene that fails twice is skipped (bundle marked Partial); a stricter gate raises this risk. The on-screen-number gate gives the exact number to fix on the retry, so it should rarely cost a scene, but it is fail-closed by design. | `streamVideo.ts:121` | Accepted; watch on dogfood. |
| R8 | **Whole-section script = first-frame latency.** Nothing can play until the entire sonnet script exists; at "complete" detail that is 30+ beats of output before scene 1 starts. | `streamVideo.ts:175` | Open (P2). |
| R9 | **Tutor retrieval is keyword overlap.** Paraphrased questions can miss the right paragraph; the prompt then correctly says "the section doesn't cover it" and gives general help, which is ungrounded by design. | `retrieve.ts`, `tutor.ts:49` | Open (P6). |
| R10 | **Passage ids are not verified against content.** The textbook highlight trusts the model's `[pN]` choice. A wrong id shows the wrong paragraph as the source. | `script.ts` normalise | Open (P4 covers it). |

## 3. Research summary

### Grounding and hallucination in source-grounded generation
- Hallucination surveys separate *intrinsic* errors (contradicting the source) from *extrinsic* ones (adding unverifiable
  content); extrinsic additions are the common failure in summarisation/rewriting, which is what our script stage does.
  [Ji et al. 2023, ACM CSUR](https://arxiv.org/abs/2202.03629); [Huang et al. 2023](https://arxiv.org/abs/2311.05232).
- Retrieval grounding helps only if the generator is constrained to the retrieved text and the output is checked
  against it. [Lewis et al. 2020, RAG](https://arxiv.org/abs/2005.11401). Long contexts lose material in the middle,
  an argument for passing the *relevant* passages per beat rather than whole chapters.
  [Liu et al. 2023, Lost in the Middle](https://arxiv.org/abs/2307.03172).
- **Quote/attribution first.** Anthropic recommends extracting word-for-word quotes before the task, citing a quote
  per claim, and explicitly allowing "I don't know"; it warns these reduce but do not eliminate hallucinations.
  [Anthropic: Reduce hallucinations](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).
  The API's [Citations](https://docs.anthropic.com/en/docs/build-with-claude/citations) feature returns exact
  source spans, which makes citations verifiable by construction (not available through `claude -p`).
- **Citation evaluation.** ALCE measures citation recall/precision with an NLI model and finds even strong models leave
  many claims without full support. [Gao et al. 2023, ALCE](https://arxiv.org/abs/2305.14627). The AIS framework
  defines "attributable to an identified source" as the bar. [Rashkin et al. 2021](https://arxiv.org/abs/2112.12870).
  RARR revises output post hoc to match retrieved evidence while preserving the original. [Gao et al. 2022, RARR](https://arxiv.org/abs/2210.08726).
- **Claim extraction + entailment.** Decompose output into atomic facts, check each against the source.
  [Min et al. 2023, FActScore](https://arxiv.org/abs/2305.14251). Sentence-level NLI works for consistency checking
  when applied at the right granularity. [Laban et al. 2022, SummaC](https://arxiv.org/abs/2111.09525);
  [Zha et al. 2023, AlignScore](https://arxiv.org/abs/2305.16739). Small dedicated checkers reach GPT-4-level
  grounding accuracy at ~400x lower cost. [Tang et al. 2024, MiniCheck](https://arxiv.org/abs/2404.10774).
- **Self-verification.** Chain-of-Verification (plan verification questions, answer them independently, revise)
  cuts hallucinated list items and long-form errors. [Dhuliawala et al. 2023](https://arxiv.org/abs/2309.11495).
  Sampling consistency flags hallucinations without a reference ([Manakul et al. 2023, SelfCheckGPT](https://arxiv.org/abs/2303.08896));
  self-consistency improves reasoning by majority vote ([Wang et al. 2022](https://arxiv.org/abs/2203.11171)).
  Both multiply calls, so they suit offline evals better than a streaming path.
- **Structured outputs.** Schema-constrained decoding removes format failures
  ([OpenAI: Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs);
  [Willard & Louf 2023](https://arxiv.org/abs/2307.09702)), but strict formats can reduce reasoning quality;
  answering in natural language then converting fared best. [Tam et al. 2024, Let Me Speak Freely?](https://arxiv.org/abs/2408.02442).
  For us: keep JSON small and keep the reasoning-heavy step (the rewrite) unconstrained in content.
- **LLM-as-judge pitfalls.** Judges show position and verbosity bias ([Zheng et al. 2023, MT-Bench](https://arxiv.org/abs/2306.05685))
  and favour their own generations ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)). A judge is an eval
  signal, not ground truth; prefer deterministic checks where possible, a different model family or a dedicated
  checker for judging, and spot-check by hand.

### Educational content
- Extraneous "interesting" additions hurt learning (seductive details); accuracy and relevance matter more than
  colour. [Harp & Mayer 1998](https://doi.org/10.1037/0022-0663.90.3.414). This argues against invented hooks even
  when they are true.
- LLM tutoring and content generation are useful but error-prone and need source grounding and teacher/student
  verification. [Kasneci et al. 2023](https://doi.org/10.1016/j.lindif.2023.102274).

### Robust streaming pipelines
- **Validation gates and targeted repair**: validate each stage's output deterministically, retry only what failed,
  feed the exact error back (already the pattern for scenes; now for script beats too).
- **Retries are bounded** and use backoff; retries amplify load and latency.
  [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/);
  [Google SRE: Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/).
- **Fail closed on correctness, fail open on garnish.** Correctness checks (numbers, entailment) should remove the
  offending unit, not the whole product; garnish (gifs, checkpoints, titles) should degrade silently. Tangent already
  fails open for gifs and checkpoints; the script now fails closed per beat.
- **Golden sets and recorded fixtures** make regressions measurable and cheap; replaying recorded model answers keeps
  evals deterministic and offline (see section 5).

## 4. Ranked plan

Latency costs assume `claude -p` (sonnet ~1-2 min per section script, haiku ~10-30 s per scene). "TTFF" = time to
first frame.

| Rank | Change | Accuracy gain | Latency cost | Effort | Status |
|------|--------|---------------|--------------|--------|--------|
| P1 | **Numeric grounding gate** on script beats + targeted beat repair + cut beats that still fail; source-only hook and an explicit accuracy block in the script prompt. | High for the most harmful error class (invented stats/dates/percents); deterministic, no judge bias. | 0 when clean; one small repair call when not (cheaper than today's full retry, so net faster). | S | **Done** |
| P1b | **On-screen number gate** in `checkTemplateScene`, checked against narration + section (section not sent to the model). | High for R3. | 0 when clean; uses the existing scene retry. | S | **Done** |
| P1c | **Targeted repair for all script violations** (style too). | — | Retry output drops from the whole script to 1-3 beats: roughly halves the worst-case TTFF. | S | **Done** |
| P2 | **Stream the script**: ask for the first scene's 3 beats first (or parse the beat array incrementally from `--output-format stream-json --include-partial-messages`) and start TTS/scene 1 while the rest is written. | — | TTFF drops from the whole script to ~3 beats of output. Biggest speed win left. | M | Planned |
| P3 | **Checkpoints from narration**: pass each scene's spoken `say` (not `visualIntent`), drop the 20k truncation in favour of the scenes' passages, and verify generated MCQ answers by the same entailment check as P4. | Medium (checks that match what was taught; fewer wrong keys). | 0 on the critical path (side call). | S | Planned |
| P4 | **Parallel claim entailment for non-numeric claims**: after the script, per scene group in parallel with TTS, one haiku call checks each beat against its own `[pN]` passages (returns supported/unsupported + the source quote). Unsupported beats get a targeted repair before their scene's DSL. Also validates passage ids (R10). | High (definitions, causal claims, overstatement). | Runs alongside TTS (~same duration), so ~0 TTFF if scene 1 is checked first; +1 haiku call per scene. | M | Planned; use the eval harness to measure false-positive rate first. |
| P5 | **Quote-then-rewrite**: each beat carries a ≤12-word verbatim `quote` from its passage, checked deterministically (normalised substring). | Medium-high; makes P4 cheaper (verify quote, judge only quote→say). | +~15 output tokens per beat on the sonnet call (~5-10 s TTFF at 30 beats). | S | Planned; measure with the harness before turning on. |
| P6 | **Tutor retrieval**: prefer the passages of the beat being narrated (`passages` ids on the scene) before keyword retrieval; quote-first answer for factual questions. | Medium. | ~0. | S | Planned |
| P7 | **Style violations stop failing the video**: after the repair, ship beats with minor speech-lint violations (long sentence, parenthetical) instead of throwing; keep accuracy violations fail-closed. | — (availability) | Removes a whole-video failure mode. | S | Planned (needs Monish's call: is a 24-word sentence worse than no video?). |
| P8 | **Golden-set CI**: run `scripts/eval-generation.ts` in replay mode in CI; re-record when prompts change. | Regression protection. | None at runtime. | S | Harness done; CI wiring open. |

Not recommended now: self-consistency / multi-sample voting on the script (2-5x sonnet cost on the critical path);
moving the scene stage to sonnet (scene numbers are now gated deterministically, and computed visuals already cover
traces); embedding-based retrieval for one section (keyword retrieval is adequate at this size). **Model tiers are
unchanged** (haiku default, sonnet for the script; the eval judge uses sonnet offline only).

## 5. What was implemented

- `src/gen/grounding.ts`: number extraction (digits, separators, decimals, percents, "3 million", spelled-out runs
  like "two hundred fifty thousand"), a source support set (with percent/fraction twins and rounding), the claim filter
  (integers 0-10 are exempt as counts) and `screenText` (which template fields show quantities; illustrative and
  computed templates are exempt).
- `src/gen/script.ts`: `checkGrounding`; accuracy block and source-only hook in the prompt; one targeted repair
  (`{"<index>": beat}`) instead of regenerating the script; beats that still state an unsupported number are cut (at
  most a quarter, else the video fails as before); `ScriptResult.dropped`.
- `src/gen/scene.ts`: on-screen number gate and a prompt rule; `generateGroupScene({source})`, passed from
  `streamVideo.ts`.
- Tests: `grounding.test.ts`, plus grounding/repair/cut cases in `script.test.ts` and `scene.test.ts`.
- `scripts/eval-generation.ts` + `scripts/eval-golden.json`: golden-set harness (below).

Known limits of the number gate: it checks values, not their meaning ("41% of students" vs "41% of teachers" passes);
small counts are not checked; the support set is the whole section, not the beat's own passages (passage tagging is
too imprecise to be strict yet). P4 closes the meaning gap.

## 6. Eval harness and results

```
TANGENT_EVAL="[--record] [--judge] [--scenes] [--verbose] [--impl <module>] [--label <name>]" \
  ./node_modules/.bin/vitest run scripts/eval-generation --silent=false
```
It is a vitest file (skipped unless `TANGENT_EVAL` is set) because the motion package uses Vite's `import.meta.glob`.
"Before" numbers come from `git show <old>:src/gen/script.ts > src/gen/script.before.ts` and `--impl` on that file
(delete it afterwards).

Golden set (`scripts/eval-golden.json`): 3 Bioethics sections from the cached test PDF IR (app data, with passages)
and 2 numeric STAT 350 sections from the committed sidecar fixture. Every model answer is recorded by
sha256(model + prompt) in `<appData>/eval/recordings.json` (outside the repo: it contains textbook text), so a
re-run with the same prompts replays offline and deterministically. Metrics per section: beats, attempts, cut beats,
remaining lint violations, beats with an unsupported number (deterministic), beats an LLM judge (sonnet) calls
unsupported, and script generation time (recorded wall time of the model calls).

### Results (2026-11-12, one sample per variant, standard detail)

| | Sections | Beats | Beats with unsupported number | Judge: unsupported beats | Mean script time | Retries |
|---|---|---|---|---|---|---|
| Before (prompt + checks at `ccc9655`) | 5 | 39 | 0 (1 before the derived-arithmetic rule) | **2 (5.1%)** | 8.5 s | 0 |
| After (this change) | 5 | 35 | 0 | **0 (0%)** | 8.7 s | 1 (malformed JSON, full regen) |

- The two "before" beats the judge flagged were an overstatement ("Real moral arguments **never** arrive tidy" where
  the source says "usually"/"often") and a hook with examples not in the source (R1/R2 in practice). Neither contains
  a number, so the deterministic gate would not have caught them; the prompt change did. P4 is the check for this class.
- The number gate flagged one "before" beat on its first version: "3 over 29 times 5 over 29 is 15 over 29 squared".
  15 is correct arithmetic, not in the source. The gate now accepts a sum/difference/product/quotient of two grounded
  numbers stated in the same beat (`grounding.ts:unsupportedNumbers`); invented operands still fail.
- Scene stage (`--scenes`, after): 10/10 scenes valid; 0 first-attempt answers had an unsupported on-screen number;
  mean 11 s of haiku time per scene. So on this set the scene gate did not fire (its prompt rule may be why); it costs
  nothing when clean.
- Speed: no measurable change when nothing fails (the prompt is ~90 words longer). The targeted repair did not
  trigger on real data in this run (the only retry was malformed JSON, which still regenerates in full), so its
  latency gain is unmeasured here; by construction its output is 1-3 beats instead of the whole script.
- Caveats: n = 5 sections, one sample each, and the judge is the same model family as the generator (self-preference
  bias, see section 3). Treat 5.1% → 0% as directional, not significant. Run more sections and a second judge
  before using these numbers for decisions.
