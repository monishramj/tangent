import { useEffect, useMemo, useState } from "react";
import useKeybinds from "./hooks/useKeybinds";
import { startMenuBridge, syncMenu } from "./menu";
import Home, { type ExtraSource, type StartMeta, type LibraryRoute } from "./home/Home";
import PlayerScreen from "./player/PlayerScreen";
import type { FollowSource } from "./player/SourceFollow";
import { tagPassages } from "./gen/sources";
import { sectionPages, sectionsPassages, sectionsExercises, sectionsFigures, sectionsText, type IR, type Passage } from "./home/api";
import { stripWatermarks } from "./gen/sanitize";
import { startSession } from "./pipeline/session";
import { recordStream, replayStream, tauriVideoStore, type VideoBundle, type VideoStore } from "./storage/videos";
import { isOfficeSource } from "./storage/library";
import { irCache, sourceFor, newId, tauriJsonStore, type JsonStore } from "./storage/store";
import { withFormulas } from "./library";
import type { PipelineEvent, Progress } from "./pipeline/streamVideo";
import type { LLMProvider } from "./llm/provider";
import { giphyKey, giphySearch } from "./media/giphy";
import { devlog } from "./devlog";
import { plainError } from "./plainError";
import FirstLaunch from "./firstLaunch/FirstLaunch";
import { checksPassed, markChecksPassed } from "./firstLaunch/checks";

type GenerateArgs = { sectionIds: string[]; ir: IR; meta: StartMeta; extras?: ExtraSource[] };
const generationKey = ({ sectionIds, meta, extras }: GenerateArgs) =>
  JSON.stringify([meta.pdfPath, sectionIds, meta.title, meta.detail, extras?.map(p => [p.pdfPath, p.sectionIds, p.name]) ?? []]);
type Screen =
  | LibraryRoute
  | { s: "generate"; args: GenerateArgs; attempt: number; back?: LibraryRoute }
  | { s: "watch"; video: VideoBundle; back?: LibraryRoute };

export default function App({ provider, store = tauriJsonStore, videoStore = tauriVideoStore, initial = { s: "home" } }: { provider?: LLMProvider; store?: JsonStore; videoStore?: VideoStore; initial?: Screen }) {
  const [ready, setReady] = useState(checksPassed);
  const [screen, setScreen] = useState<Screen>(initial);
  const inLibrary = screen.s !== 'watch' && screen.s !== 'generate';
  const libraryRoute = inLibrary ? screen : screen.back ?? { s: 'home' as const };
  useKeybinds({ settings: () => setScreen({ s: 'settings' }) }, !inLibrary);
  useEffect(startMenuBridge, []);
  // PlayerScreen pushes its own (more detailed) state while mounted; this just disables
  // Playback/Panels again once it isn't.
  useEffect(() => { if (inLibrary) syncMenu({ player: false }); }, [inLibrary]);
  if (!ready) return <FirstLaunch onContinue={() => { try { markChecksPassed(); } catch { /* this session still continues */ } setReady(true); }} />;
  return <>
    <div hidden={!inLibrary}><Home store={videoStore} jsonStore={store} provider={provider} route={libraryRoute} active={inLibrary} onNavigate={setScreen}
      onStart={(sectionIds, ir, meta, extras) => {
        const args = { sectionIds, ir, meta, extras };
        setScreen(current => current.s === "generate" && generationKey(current.args) === generationKey(args)
          ? current : { s: "generate", args, attempt: 0, back: libraryRoute });
      }}
      onOpenVideo={video => setScreen({ s: "watch", video, back: libraryRoute })} /></div>
    {screen.s === 'watch' && <Watch video={screen.video} provider={provider} store={store} onBack={() => setScreen(libraryRoute)} />}
    {screen.s === 'generate' && <Generate key={`${screen.attempt}:${generationKey(screen.args)}`} args={screen.args} provider={provider} store={store} videoStore={videoStore}
      onRetry={() => setScreen(current => current === screen ? { ...screen, attempt: screen.attempt + 1 } : current)} onBack={() => setScreen(libraryRoute)} />}
  </>;
}

function Watch({ video, provider, store, onBack }: { video: VideoBundle; provider?: LLMProvider; store: JsonStore; onBack: () => void }) {
  const stream = useMemo(() => replayStream(video), [video]);
  const [pages, setPages] = useState<number[]>([]);
  const [followSources, setFollowSources] = useState<FollowSource[] | undefined>();
  const [source, setSource] = useState<{ markdown: string; passages: Passage[] }>({ markdown: video.title, passages: [] });
  useEffect(() => {
    let live = true;
    const path = video.source.pdfPath;
    setPages([]);
    setFollowSources(undefined);
    setSource({ markdown: video.title, passages: [] });
    const parts = video.source.also?.length
      ? [{ id: video.source.id ?? sourceFor(path).id, pdfPath: path, sectionId: video.source.sectionId }, ...video.source.also]
      : null;
    if (parts) {
      void (async () => {
        const loaded: FollowSource[] = [];
        let markdown = "";
        for (const p of parts) {
          const ir = await irCache(store).get(p.id).catch(() => null);
          if (!ir || !Array.isArray(ir.sections)) { loaded.push({ id: p.id, pdfPath: p.pdfPath, pages: [], passages: [], missing: true }); continue; }
          const ids = p.sectionId.split("+").filter(Boolean);
          const passages = sectionsPassages(ir, ids).map(x => ({ ...x, id: `${p.id}/${x.id}` }));
          loaded.push({ id: p.id, pdfPath: p.pdfPath, pages: isOfficeSource(p.pdfPath) ? [] : sectionPages(ir, p.sectionId), passages });
          const text = stripWatermarks(await sectionsText(ir, ids));
          markdown += (markdown && text ? "\n\n" : "") + text;
        }
        if (live) { setFollowSources(loaded); setPages([]); setSource({ markdown: markdown || video.title, passages: loaded.flatMap(s => s.passages) }); }
      })();
      return () => { live = false; };
    }
    void irCache(store).get(sourceFor(path).id).then(async ir => {
      if (!ir || !Array.isArray(ir.sections)) return;
      const ids = video.source.sectionId.split("+");
      const passages = sectionsPassages(ir, ids);
      if (live) {
        setPages(isOfficeSource(path) ? [] : sectionPages(ir, video.source.sectionId));
        setSource({ markdown: passages.map(p => p.markdown).join("\n\n") || video.title, passages });
      }
      const markdown = stripWatermarks(await sectionsText(ir, ids));
      if (live && markdown) setSource({ markdown, passages });
    }).catch(() => {});
    return () => { live = false; };
  }, [video, store]);
  return <PlayerScreen stream={stream} title={video.title} kicker={video.source.sectionTitle !== video.title ? video.source.sectionTitle : "Tangent"}
    textbook={{ pdfPath: video.source.pdfPath, pages }} followSources={followSources} videoId={video.id} section={source.markdown} passages={source.passages} provider={provider} store={store} autoPlay onBack={onBack} />;
}

/** Read the section, start the pipeline, record it into a bundle, and play it as it streams. */
function Generate({ args, provider, store, videoStore, onRetry, onBack }: {
  args: GenerateArgs; provider?: LLMProvider; store: JsonStore; videoStore: VideoStore; onRetry: () => void; onBack: () => void;
}) {
  const [videoId] = useState(() => newId("v"));
  const [progress, setProgress] = useState<Progress>();
  const [state, setState] = useState<{ stream: AsyncIterable<PipelineEvent>; markdown: string; passages: Passage[]; followSources?: FollowSource[] } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const { sectionIds, meta } = args;
    // StrictMode cleans up its first effect before preparation starts.
    void Promise.resolve().then(async () => {
      try {
        signal.throwIfAborted();
        const parts = [{ pdfPath: meta.pdfPath, ir: args.ir, sectionIds, name: meta.title }, ...(args.extras ?? [])].filter(p => p.sectionIds.length);
        const prepared = [];
        for (const p of parts) {
          const ir = await withFormulas(p.pdfPath, p.ir, p.sectionIds, store,
            n => { if (n && !signal.aborted) setProgress({ step: "formulas", formulas: n, scene: 0, scenesReady: 0, scenesTotal: 0, beats: [] }); }, signal);
          signal.throwIfAborted();
          const markdown = stripWatermarks(await sectionsText(ir, p.sectionIds, signal));
          signal.throwIfAborted();
          const id = sourceFor(p.pdfPath).id;
          prepared.push({
            id, pdfPath: p.pdfPath, name: p.name, sectionIds: p.sectionIds,
            markdown,
            passages: sectionsPassages(ir, p.sectionIds),
            figures: sectionsFigures(ir, p.sectionIds),
            exercises: sectionsExercises(ir, p.sectionIds),
            pages: isOfficeSource(p.pdfPath) ? [] : sectionPages(ir, p.sectionIds.join("+")),
          });
        }
        if (!prepared.length) return;
        const passages = tagPassages(prepared);
        const markdown = prepared.map(p => p.markdown).filter(Boolean).join("\n\n");
        const followSources = prepared.length > 1 ? prepared.map(p => ({ id: p.id, pdfPath: p.pdfPath, pages: p.pages, passages: passages.filter(x => x.id.startsWith(`${p.id}/`)) })) : undefined;
        const key = await giphyKey();
        signal.throwIfAborted();
        const [first, ...rest] = prepared;
        const stream = startSession({
          irSection: { markdown, passages, figures: prepared.flatMap(p => p.figures), exercises: prepared.flatMap(p => p.exercises) },
          sources: prepared.map(p => ({ id: p.id, markdown: p.markdown })),
          provider, signal, gifSearch: key ? giphySearch(key) : null, detail: meta.detail,
          onStatus: s => devlog(`status ${s}`), onProgress: p => { if (!signal.aborted) setProgress(p); },
        });
        setState({ markdown, passages, followSources, stream: recordStream(stream, { id: videoId, title: meta.title, detail: meta.detail, source: { ...(rest.length ? { id: first.id } : {}), pdfPath: first.pdfPath, sectionId: first.sectionIds.join("+"), sectionTitle: meta.title, ...(rest.length ? { also: rest.map(p => ({ id: p.id, pdfPath: p.pdfPath, sectionId: p.sectionIds.join("+"), sectionTitle: p.name })) } : {}) } }, videoStore, e => devlog(`video save failed ${String(e)}`)) });
      } catch (e) {
        if (signal.aborted) return;
        setState({ error: plainError(e) });
        controller.abort();
      }
    });
    return () => controller.abort();
  }, [args, provider, store, videoStore, videoId]);
  // Still preparing (formulas, section text): a stream that never ends, so the player shows loading, not "Couldn't build".
  // On a preparation error, remount on an ended stream so initialError shows instead of loading forever.
  const waiting = useMemo<AsyncIterable<PipelineEvent>>(() => ({
    [Symbol.asyncIterator]() {
      const done = { done: true, value: undefined } as const;
      let close!: () => void;
      const pending = new Promise<typeof done>(resolve => { close = () => resolve(done); });
      return { next: () => pending, return: () => { close(); return pending; } };
    },
  }), []);
  const ended = useMemo(() => (async function* () {})(), []);
  const error = state && "error" in state ? state.error : null;
  return <PlayerScreen stream={state && "stream" in state ? state.stream : error ? ended : waiting} key={state && "stream" in state ? "live" : error ? "error" : "wait"} title={args.meta.title}
    kicker={args.meta.pdfPath.split(/[\\/]/).pop()} videoId={videoId} section={state && "markdown" in state ? state.markdown : ""} passages={state && "passages" in state ? state.passages : []} provider={provider} store={store}
    textbook={{ pdfPath: args.meta.pdfPath, pages: isOfficeSource(args.meta.pdfPath) ? [] : sectionPages(args.ir, args.sectionIds.join("+")) }}
    followSources={state && "followSources" in state ? state.followSources : undefined}
    progress={progress} onRetry={onRetry} onBack={onBack} autoPlay initialError={error ? `Couldn't start this section. ${error}` : undefined} />;
}
