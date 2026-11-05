# @tangent/motion

The rendering half of Tangent, kept app-agnostic so it can be published on its own.

- `dsl/`: scene schema (zod), validator, templates (layouts the LLM fills), timeline compiler, computed components (`Array`, `Tree` ops).
- `stage/`: pure scene state at time *t* (`applyEventsAt`) and a PixiJS v8 renderer.
- `player/`: playback on the audio clock (`Player`, `SceneQueue` for streamed scenes).

Rules: no imports from the app (`@/…`), no React, no Tauri. Seeking is just a different *t*.
