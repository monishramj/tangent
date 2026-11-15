# Motion engine, DSL, templates, style

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [motion-identity.md](../motion-identity.md)

## Contract

### Rendering: custom engine + scene DSL (decided)
- The LLM emits a **constrained, schema-validated JSON DSL**, not free-form animation code.
  - Why: reliable from weak/local models, cheap targeted retries, trivially streamable, and every object has an ID in a scene graph we own, so the tutor can target it.
- **Live playback in-app (PixiJS on Canvas/WebGL). No MP4 rendering during playback.** Per-scene cost = LLM generation + TTS. MP4 export is an optional v1 feature.
- **Animations anchor to narration words, not seconds** (see *Audio–visual sync*).
- Keep the core tiny:
  - Primitives: text, **KineticText**, KaTeX math, shapes, arrows, lines, plots/axes, media (gif/image)
  - ~8 actions: create, fade, move, transform/morph, highlight, indicate, camera, wait (+ `op` for computed components)
  - Transitions between beats/scenes: hard cut, whip, push, match-cut
  - Domain components that grow with my courses: `Array`, `Tree` (MVP) → `Heap`, `Graph`, `Datapath`, `Pipeline`, `Distribution`, 3D transform helpers
  - A TS escape hatch for rare custom visuals

### Scene DSL v0 (DRAFT, to review)
```json
{
  "scene": "s03-heapify",
  "objects": [
    { "id": "title", "type": "KineticText", "text": "HEAPIFY", "variant": "slam" },
    { "id": "h", "type": "Heap", "kind": "max", "init": [3, 9, 7, 1, 4] }
  ],
  "beats": [
    {
      "say": "Heapify fixes one broken spot in a heap.",
      "actions": [
        { "at": "Heapify", "do": "create", "target": "title" },
        { "at": "broken spot", "do": "highlight", "target": "h.slot[0]", "color": "burgundy" }
      ],
      "cite": "p. 287"
    },
    {
      "say": "The parent swaps with its bigger child. Then we check again, one level down.",
      "actions": [
        { "at": "swaps", "do": "op", "target": "h", "op": "siftDown", "args": [0] }
      ],
      "transition": "cut"
    },
    { "reaction": { "intent": "satisfying click", "maxSec": 2 } }
  ]
}
```
(Worked check: max-heap `[3,9,7,1,4]`, `siftDown(0)`: 3 swaps with its bigger child 9 → `[9,3,7,1,4]`; at slot 1, 3 swaps with its bigger child 4 → `[9,4,7,1,3]`. The component computes this, not the LLM.)
- `say` = display/spoken source text; math-to-speech converts it to the TTS string, and anchors match against `say`.
- Addressing: `obj.slot[i]` = a **position** (array index / heap slot); `obj.val(9)` = an **element identity** that follows the value through ops. Both needed: "highlight the root" vs "follow the 9".
- `op` actions on computed components run the real algorithm; the compiler expands one `op` into its step animations spread across the anchor gap.
- `reaction` beats: optional gif interstitial, no narration.
- Open on the schema: multi-anchor ranges (`"from": … "to": …`), camera DSL, how branch scenes reference the parent scene graph.

### Visual style: first style pack = "black × Code Report" (decided; replaces dark academia)
- **App UI and scenes share it:** pure black base, white type at a few opacities, neutral grays, one restrained accent. No hues by default. The app shell UI (React + React Bits + Hugeicons) is already built this way.
- **Type:** clean system sans for headlines and UI (big kinetic headlines stay bold and tight), mono for code and LEGv8.
- **Motion:** Code Report-style energy (fast cuts, whip transitions, big animated text that slams in, keyword scale-punches, word-by-word reveals pinned to narration), full-screen graphics, graphs, and visualizations. **Never** a static frame with bullet points.
- **Reaction gifs** between content beats (see below) as punctuation.
- Style is a swappable layer (palette, type, easing, transition set, texture), so other packs can come later.

## Dogfood courses (Fall 2026) → visual vocabulary
- **CS 251** (data structures & algorithms): array/pointer traces, tree rotations, heaps, graph traversals. **MVP dogfood course.**
- **CS 250** (computer architecture, LEGv8, zyBook): datapath/pipeline diagrams, signals through muxes/ALU, instruction encoding.
- **STAT 350**: distributions morphing, shaded areas, sampling simulations.
- **CS 334** (graphics): matrices acting on geometry, 3D transforms, rasterization.

## Tree component
- `Tree` has a `kind`: `bst` (default), `avl`, `redblack`, `btree`, `heap`, `generic`. Each kind owns its ops, registered by kind. Node data is nested (`keys`, `children`, optional `color`) so B-trees (many keys per node) fit; level-order arrays stay as shorthand for binary kinds.
- Array heaps: max by default, `heap: "min"` option.

- Text overflowing its box at small player sizes (chat bubbles, venn circles, any fitted text): the 18 px font floor was absolute, so small stages couldn't shrink text to fit. The floor now scales with stage height (`minFont(h) = min(18, 0.02·h)` in `stage/layout.ts`). Venn items get a row-height `maxH`, two-set items are centred in their crescent and three-set items sit inside their own circle.

- Heapify demo removed from the app (Home button + App "demo" screen). `@motion/stage/demo` stays as a test fixture.

- Layout: shapes and Math pack 3 per row, and big components get their own row, with cell sizes (`cw`/`ch`) that shapes fit into. Arrows are trimmed to box edges and sit under the boxes, and boxes are opaque.

## Log

- 2026-11-15 Step 16: oldest objects above 8 visible fade over 0.3 s after their final narration/action; Tangenter stays.
  Compiler stores aligned phrase ends; legacy timelines preserve targets through their spoken beat; validator rules unchanged.
  Evidence: retirement/anchor/seek tests, renderer canvas+DOM composition tests, affected suite and TypeScript check.
  Not verified: real GPU frames; no standalone frame-snapshot tool (only live Stage snapshots).
