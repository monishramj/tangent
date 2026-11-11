import { useEffect, useMemo, useState } from "react";
import Home, { type StartMeta, type LibraryRoute } from "./home/Home";
import PlayerScreen from "./player/PlayerScreen";
import { sectionPages, sectionsPassages, sectionsExercises, sectionsFigures, sectionsText, type IR } from "./home/api";
import { stripWatermarks } from "./gen/sanitize";
import { startSession } from "./pipeline/session";
import { recordStream, replayStream, tauriVideoStore, type VideoBundle, type VideoStore } from "./storage/videos";
import { irCache, sourceFor, newId, tauriJsonStore, type JsonStore } from "./storage/store";
import type { PipelineEvent, Progress } from "./pipeline/streamVideo";
import type { LLMProvider } from "./llm/provider";
import { giphyKey, giphySearch } from "./media/giphy";
import { devlog } from "./devlog";

type GenerateArgs = { sectionIds: string[]; ir: IR; meta: StartMeta };
type Screen =
  | LibraryRoute
  | { s: "generate"; args: GenerateArgs; attempt: number; back?: LibraryRoute }
  | { s: "watch"; video: VideoBundle; back?: LibraryRoute };

export default function App({ provider, store = tauriJsonStore, videoStore = tauriVideoStore, initial = { s: "home" } }: { provider?: LLMProvider; store?: JsonStore; videoStore?: VideoStore; initial?: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);
  switch (screen.s) {
    case "watch": return <Watch video={screen.video} provider={provider} store={store} onBack={() => setScreen(screen.back ?? { s: "home" })} />;
    case "generate": return <Generate key={screen.attempt} args={screen.args} provider={provider} store={store} videoStore={videoStore}
      onRetry={() => setScreen({ ...screen, attempt: screen.attempt + 1 })} onBack={() => setScreen(screen.back ?? { s: "home" })} />;
    default: return <Home store={videoStore} jsonStore={store} provider={provider} route={screen} onNavigate={setScreen}
      onStart={(sectionIds, ir, meta) => setScreen({ s: "generate", args: { sectionIds, ir, meta }, attempt: 0, back: screen })}
      onOpenVideo={video => setScreen({ s: "watch", video, back: screen })} />;
  }
}

function Watch({ video, provider, store, onBack }: { video: VideoBundle; provider?: LLMProvider; store: JsonStore; onBack: () => void }) {
  const stream = useMemo(() => replayStream(video), [video]);
  const [pages, setPages] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    setPages([]);
    void irCache(store).get(sourceFor(video.source.pdfPath).id).then(ir => {
      if (live) setPages(ir && Array.isArray(ir.sections) ? sectionPages(ir, video.source.sectionId) : []);
    }).catch(() => {});
    return () => { live = false; };
  }, [video, store]);
  return <PlayerScreen stream={stream} title={video.title} kicker={video.source.sectionTitle !== video.title ? video.source.sectionTitle : "Tangent"}
    textbook={{ pdfPath: video.source.pdfPath, pages }} videoId={video.id} section={video.title} provider={provider} store={store} autoPlay onBack={onBack} />;
}

/** Read the section, start the pipeline, record it into a bundle, and play it as it streams. */
function Generate({ args, provider, store, videoStore, onRetry, onBack }: {
  args: GenerateArgs; provider?: LLMProvider; store: JsonStore; videoStore: VideoStore; onRetry: () => void; onBack: () => void;
}) {
  const [videoId] = useState(() => newId("v"));
  const [progress, setProgress] = useState<Progress>();
  const [state, setState] = useState<{ stream: AsyncIterable<PipelineEvent>; markdown: string } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { sectionIds, ir, meta } = args;
    const sectionId = sectionIds.join("+");
    void (async () => {
      try {
        const markdown = stripWatermarks(await sectionsText(ir, sectionIds));
        if (controller.signal.aborted) return;
        const key = await giphyKey();
        const stream = startSession({
          irSection: { markdown, passages: sectionsPassages(ir, sectionIds), figures: sectionsFigures(ir, sectionIds), exercises: sectionsExercises(ir, sectionIds) },
          provider, signal: controller.signal, gifSearch: key ? giphySearch(key) : null, detail: meta.detail,
          onStatus: s => devlog(`status ${s}`), onProgress: p => { if (!controller.signal.aborted) setProgress(p); },
        });
        setState({ markdown, stream: recordStream(stream, { id: videoId, title: meta.title, detail: meta.detail, source: { pdfPath: meta.pdfPath, sectionId, sectionTitle: meta.title } }, videoStore, e => devlog(`video save failed ${String(e)}`)) });
      } catch (e) { if (!controller.signal.aborted) setState({ error: String(e) }); }
    })();
    return () => controller.abort();
  }, [args, provider, videoStore, videoId]);
  const empty = useMemo(() => (async function* () {})(), []);
  const error = state && "error" in state ? state.error : null;
  return <PlayerScreen stream={state && "stream" in state ? state.stream : empty} key={state && "stream" in state ? "live" : "wait"} title={args.meta.title}
    kicker={args.meta.pdfPath.split(/[\\/]/).pop()} videoId={videoId} section={state && "markdown" in state ? state.markdown : ""} provider={provider} store={store}
    textbook={{ pdfPath: args.meta.pdfPath, pages: sectionPages(args.ir, args.sectionIds.join("+")) }}
    progress={progress} onRetry={onRetry} onBack={onBack} autoPlay initialError={error ? `Couldn't start this section: ${error}` : undefined} />;
}
