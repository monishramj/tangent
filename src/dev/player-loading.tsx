import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import PlayerScreen from "../player/PlayerScreen";
import type { PipelineEvent, Progress } from "../pipeline/streamVideo";
import { memoryJsonStore } from "../storage/store";
import { scene, timeline } from "@motion/stage/demo";
import "../index.css";

// Local silence keeps the real player fixture independent of Tauri, models and network audio.
const bytes = new Uint8Array(44 + 8000 * Math.ceil(timeline.totalSec) * 2);
const header = new DataView(bytes.buffer);
for (const [at, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const)
  [...text].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
header.setUint32(4, bytes.length - 8, true); header.setUint32(16, 16, true);
header.setUint16(20, 1, true); header.setUint16(22, 1, true);
header.setUint32(24, 8000, true); header.setUint32(28, 16000, true);
header.setUint16(32, 2, true); header.setUint16(34, 16, true);
header.setUint32(40, bytes.length - 44, true);
const wavPath = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
const store = memoryJsonStore();
const progress: Progress = { step: "animation", scene: 1, scenesReady: 1, scenesTotal: 4, beats: [] };

function Fixture() {
  const [mode, setMode] = useState(new URLSearchParams(location.search).get("mode") ?? "generating");
  const stream = useMemo(() => (async function* (): AsyncIterable<PipelineEvent> {
    if (mode === "waiting") await new Promise(() => {});
    yield { type: "scene", sceneId: "fixture", scene, timeline, wavPath, generationMs: 0 };
    if (mode === "generating" || mode === "buffering") await new Promise(() => {});
  })(), [mode]);
  return <>
    <PlayerScreen key={mode} stream={stream} title="Building a heap" store={store}
      progress={mode === "replay" ? undefined : { ...progress, scenesReady: mode === "done" ? 4 : mode === "waiting" ? 0 : 1 }} />
    <div className="fixed top-20 left-3 z-50 flex gap-2 text-xs">
      {["waiting", "generating", "buffering", "done", "replay"].map(m => <button key={m} className="rounded bg-surface-2 px-3 py-2" aria-pressed={m === mode} onClick={() => setMode(m)}>{m}</button>)}
    </div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
