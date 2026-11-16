# Player loading percentage

Orca browser captures of the real PlayerScreen using `src/dev/player-loading.html`.

- `before-waiting.png`: original bottom-aligned loading ring and stage-only label.
- `before-updating.png`: original mid-video wait.
- `after-waiting.png`: centered generation percentage and secondary stage.
- `after-updating.png`: centered mid-video “Updating video” percentage.

Open `?mode=waiting` for the first-scene wait. Open `?mode=buffering`, press Play and let the local silent scene end for the mid-video wait. The fixture holds the stream open, requires no models or Tauri, and uses the same renderer and loading overlay as the app.

Weights are completed script (20%), then 80% divided over known scenes, with narration worth 60% of a scene and completed animation the rest. Progress is held at its highest value when concurrent events reorder or the continuation script expands the total; only a completed stream reaches 100%. These are completed-work weights, not an elapsed-time forecast.
