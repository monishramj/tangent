# Motion identity: design revision (for approval)

Status: approved 2026-11-10 with additions (icons and axes draw on, leader lines from labels, the tonal Look in section 3b). Implemented 2026-11-10 except the pen-loop overshoot and per-frame background variation (see "Not done" in CLAUDE.md). The backdrop has a soft ground glow rather than a horizon line (the hard edge read as banding). Before-frames (all 93 reel beats, 4 times each, 1072×603):
`/private/tmp/claude-501/-Users-monishramj-Documents-Code-orca-workspaces-tangent-expand-videos/c26fa369-b59a-48d0-9164-cde7a1a7950c/scratchpad/before/` (`sheet_NN.png` = 6 beats per contact sheet, `NN_<template>-<variant>_<dt>.png` = single frames).

## 1. Diagnosis (grouped by root cause)

**Drawing design: it reads as a wireframe.**
- Two unrelated line weights: shapes/connectors are a hairline (0.36% of stage height, ~2.6 px at 720p), the stick figure is 1.2% (3.3× heavier). Charts, tables, flow and figure frames hard-code 1–4 px. See `sheet_24` (chart-bars, chart-line, figure), `sheet_12` (diagrams next to characters).
- Every container is the same thin rounded box with a 7% grey fill (versus, list-grid, steps-cards, procon-cards, definition, stamp card): `sheet_06`, `sheet_42`. Perfect geometric lines, no hand in them.

**Typography: too small, flat hierarchy.**
- Headings are .05 of stage height and body labels .028–.036, so frames are mostly empty black with tiny text (`42_steps-cards_4.8`, `43_steps-ladder_4.8`, `25_chart-bars_4.8`, `24_tree-default_4.8`: the tree is ~12% of the frame).

**Composition.**
- Left-heavy or thin-band layouts: `08_list-column_4.8` (block sits at x .2–.45), `14_diagram-flow-h_4.8` (a thin strip), `44_steps-vertical_4.8`.
- Content appears before its container: `06_versus-split_0.15` shows the title and icon floating while the card outline is still a top edge.

**Motion (from code + frames).**
- Everything created on the same word animates at once (card + title + icon + text): no reading order.
- Entrance transforms are tied to event length: the stat counter scales up and fades for the whole 1.2 s count (`04_stat-center_0.45` is still grey and small).
- Bounce everywhere: every icon/emoji uses `bounce` (10% overshoot + an 11° wobble + emoji squash); `pop` and `punch` text overshoot too.
- Pose changes are a plain ease-out blend: no anticipation, no settle. The Tangenter scales in (pop) while walking, which reads floaty. `wave` loops forever.

**Identity.** Nothing recurs: no signature line, entrance or detail that says "Tangent".

## 2. Vision

Tangent looks like one person drawing an explanation on a black board while talking. Lines are drawn on with the words, slightly imperfect and confident (MinutePhysics, inverted to white on black). Everything belongs to one system: one line, one corner, one set of curves, one accent (Kurzgesagt's cohesion and smooth, purposeful camera, without its palette). The stick figure makes it human: it waits, then reacts, and gestures at the thing being named (CrashCourse warmth). Secondary seasoning: key words hit hard and then sit still (Fireship), one idea revealed at a time with no linear motion and no bounce on text (3Blue1Brown), deadpan posture for the figure (xkcd). Avoided: Fireship's meme density as a look, Kurzgesagt colour, 3b1b's maths-only austerity, any wobble that keeps moving ("line boil").

## 3. Design system (tokens in `stage/motion.ts`, used everywhere)

- **Line** (`STROKE`, fractions of stage height): `hair` .0025 (axes, grids, guides), `line` .0055 (every outline and connector), `bold` .008 (stick figure, check/cross, key marks). Round caps and joins always. The figure scales its weight with its size, between `line` and `bold`.
- **Hand** (`handPath` in `geometry.ts`): outlines and long lines get a fixed, seeded wobble of at most 0.35 × line width at low frequency, and closed outlines overshoot their start by ~1.5 line widths, like a pen closing a loop. Static per object (seeded by id), never animated. Text, charts' data marks and computed components' values stay exact.
- **Corners / fills:** one radius, .022 h, for all cards and panels; pills for chips and bubbles. Card fill drops from 7% to 4%; filled (inverted) shapes only for the key element.
- **Type scale** (stage heights): display .16 / .12, headline .075, title .058, body .042, caption .032 (floor; nothing smaller). Bold for display, headline, title and labels inside shapes; regular for body; captions at 60% opacity.
- **Spacing:** safe margin .07 w / .08 h; gaps on a .015 step; blocks are centred on their measured content, not on a fixed x.
- **Accent:** only the beat's key element (`c.key`) and computed results (needle, winner, verdict). Never decoration.
- **Easing set** (the only curves templates may use): `enter` outQuart .32 s; `draw` inOutSine .45 s (pen pace; big outlines .6 max); `settle` soft back, 5% overshoot, objects only (never text); `move` inOutCubic .5 s; `exit` inCubic .18 s; `impact` outExpo (slam, stamp, flip); `linear` only for counters and progress. `outBack` is retuned to the soft 5% everywhere.
- **Stagger:** elements sharing a narration anchor enter 60 ms apart (300 ms cap), in the order container → heading → picture → detail. Applied once in `expandTemplates`, not per template.
- **Signature enter/settle:** "draw, fill, land": the outline is drawn on, the fill arrives in the last 30%, then one 3% settle. Entrance transforms run for a fixed .32 s even when the reveal (count-up, chart, long trace) is longer. Text rises 2.5% and fades word by word; it never scales past 1 except the `impact` styles.
- **Recurring detail:** a short hand-drawn underline tick drawn under each frame heading (white at 50%; accent only on an `accent` beat).
- **Transitions:** whip .3 s inOutCubic, push .35 s outQuart, cut; unchanged in structure. Camera moves use `move`.
- **Stick figure:** head .095 H (slightly larger), hand-drawn head outline, weight from `STROKE`. Pose changes: 15% anticipation (8% counter-move), 6% overshoot, settle. Breathing stays; `wave` does two waves then rests. The Tangenter walks in over .6 s (two steps), no scale pop, and holds ~.4 s before its first gesture.

## 3b. Look: tonal depth on black (owner addition)

Kurzgesagt's construction without its colour: rounded forms, one light, flat shading, layered depth. Tokens live in `stage/look.ts`.

- **Grey ramp** (`TONE`): bg `#060606`, low `#161616` (surfaces), mid `#242424` (raised or secondary surfaces), high `#3a3a3a` (character body, bar faces), dim `#8a8a8a` (shadow-side rims, guides), ink `#ffffff` (type, lit rims, key element). Body text is always ink on low or darker (contrast above 15:1). The accent `#ffb224` replaces ink on the key element only.
- **Light:** from the top-left, direction (0.6, 0.8). Every surface obeys it; nothing is lit from elsewhere.
- **Bodies** (cards, nodes, bubbles, cells; any closed shape over 7% of stage height): (1) a flat hard shadow, the same silhouette offset 0.011 h down and 0.008 h right, black at 60%, no blur; (2) surface fill `low`; (3) the outline in the house line at 42% (the shadow side); (4) the lit side (segments facing up-left) redrawn in ink at 100%. Small marks, pivoting parts and computed polygons (dominoes, needles, pans) get the line only, so their geometry stays exact. Inverted (white-filled) bodies are reserved for the key element and keep the shadow but no rim.
- **Draw-on with shading:** the outline is traced dim, the lit side brightens as the pen passes, the fill and shadow arrive in the last 30% of the trace. So a body is "drawn, then becomes solid".
- **Backdrop** (one pre-rendered 640×360 texture behind everything): a pool of light centred at 39% x, 36% y falling from `#1d1d1d` to `#050505`; two large soft forms at 3–3.5% white (top-right, bottom-left); a ground plane that starts at 73% height with a faint horizon. It moves and zooms 25% as much as the content on camera moves (parallax), and does not move with whip/push.
- **Grain and vignette** (one pre-rendered 960×540 texture above everything): seeded two-tone noise at up to 5% alpha, static; a radial vignette from clear at 40% of the diagonal to black at 50% in the corners. No per-frame work.
- **Character** (the Tangenter and every in-template figure are the same design): height H.
  - Head: circle, radius 0.095 H, filled `mid`, outline in the house line with the lit side in ink; one eye dot (0.012 H) toward the facing side, placed 35% of the radius forward and 10% up. No mouth; expression is posture.
  - Body: a bean (rounded tapered capsule) from hip to neck, 0.075 H wide at the shoulders and 0.06 H at the hip, filled `high`, lit rim on the up-left side. It leans with the pose (the existing `lean` joint).
  - Limbs: single ink strokes with round caps at the figure weight (between `line` and `bold`, 2.6% of H), drawn behind the body for the far arm and leg and in front for the near ones. Hands and feet are the round stroke ends; no fingers.
  - Ground: a flat ellipse shadow under the feet (0.3 H wide, 0.03 H tall, black 50%).
  - Poses: the nine existing ones. Timing: hold, then react. A change takes .45 s: 15% anticipation (8% of the travel in the opposite direction), a 6% overshoot, settle. Breathing ±1° stays; `wave` waves twice and rests.
  - Entrance: drawn on (head, body, limbs in that order), fill last. The Tangenter walks in over .6 s with two steps and no scale.
- **How the liked pieces look in this system:**
  - Cards, containers, bubbles: bodies as above, radius 0.022 h; speech bubbles keep their tail and get the same shadow.
  - Charts: bars are bodies (face `high`, lit top and left edge), the highlighted bar is ink or accent; axes in the hair weight drawn on first; the line chart is a single bold ink stroke with ink dots.
  - Iceberg: the tip is the one inverted (ink) body above the water; the mass is a `low` body under a waterline in the house line; the sea is a 10% ghost; strata are dashed hair lines with a leader tick to each label. Pan and pull-back unchanged.
  - Stamp: the claim card is a body; the stamp stays accent line and type with its tilt, slam and shake unchanged (no shadow, it is ink on paper).
  - Flip card: front is a `low` body, back is the inverted ink body with the shadow; the flip is unchanged.
  - Diagrams: nodes are bodies; edges in the house line drawn on; each edge label sits on a short leader tick.
- **Leader lines** (CrashCourse "pointed at"): a label that names a thing gets a short hand-drawn tick from the label toward the thing, drawn on with the label's word (diagram edge labels, chart highlight, iceberg layers, figure callouts). Length 3–5% of stage height, hair weight, 70% ink.
- **Performance:** two static sprites, one extra polygon fill and at most a few extra strokes per body; the hand wobble and lit runs are computed per size, not per frame.

## 4. Change list

Root level first:
1. `stage/motion.ts`: `STROKE`, `TYPE`, `RADIUS`, `EASE`/duration tokens, soft `outBack`, `anticipate` curve.
2. `stage/geometry.ts`: `handPath` (seeded wobble + loop overshoot), used by shapes, lines/arrows and marks.
3. `stage/scene.ts`: fixed-length entrance transforms; `pop`/`bounce` become one soft settle without rotation or squash; `punch` loses its overshoot; pose events pass raw progress.
4. `stage/renderer.ts`, `visuals.ts`, `vocab.ts`, `extras.ts`: all strokes from `STROKE`; one radius; chart/table/code/figure restyled (heavier axis-free bars, larger labels); larger Tree/Graph nodes.
5. `stage/person.ts`: proportions, weight, anticipation/settle, wave limit, Tangenter walk-in.
6. `dsl/templates.ts` (`expandTemplates`): same-anchor stagger; `dsl/tplkit.ts`: `head()` with the underline tick, type-scale helpers.

Per template (sizes move to the type scale everywhere):
- versus, list-grid, steps-cards, procon-cards, definition-card: container lands first; bigger titles and points.
- list-column, checklist, steps-vertical: block centred on its content.
- diagram: larger nodes, uses the full height; steps-ladder: bigger boxes.
- stat, pictograph, gauge, distribution counters: fixed-length entrance.
- chart, table, code, tree, graph, matrix: stroke and label sizes.
- character, hook-character, chat, scale, gauge, race, dominoes: figure weight and pose timing.

**Not changing:** word-anchored timing and the compiler; computed values (ops, tilt, finish order, angles, percentages); determinism in t; template names, slots and the prompt guide; iceberg's pan and pull-back; stamp slam's impact and shake; the card flip; the stick figure's poses and draw-on entrance (it only gains weight consistency and gesture timing); whip/push/cut structure; pure black, white, one accent.

## 5. Risks and checks

- Text fit: larger type can overflow boxes. Check: existing fit tests, plus the reel at 1072 px and at a small stage (480 px).
- Wobble on computed visuals: applied to outlines only, never to positions that carry meaning (pans, needle, dominoes). Check: the tpl tests for tilt/angles/finish order.
- Timing: the stagger adds `delay` to creates; an action on the same object within 300 ms could overlap. The stagger skips objects with another action on the same anchor, and the cap keeps it under one word.
- Performance: `handPath` is computed once per size, not per frame.
- Verification: `bunx tsc --noEmit -p .`, `bunx vitest run`, full reel re-capture with before/after pairs.
