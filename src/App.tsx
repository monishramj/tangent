import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import Home from "./home/Home";
import ProjectPage, { type GenerateArgs, type PracticeItem } from "./project/ProjectPage";
import Settings from "./settings/Settings";
import PlayerScreen from "./player/PlayerScreen";
import { results } from "./player/CheckpointCard";
import { sectionExercises, sectionFigures, sectionText } from "./home/api";
import { loadIr, loadSections } from "./library";
import { stripWatermarks } from "./gen/sanitize";
import { startSession } from "./pipeline/session";
import { recordStream, replayStream, tauriVideoStore, type VideoBundle, type VideoStore } from "./storage/videos";
import { newId, projects, tauriJsonStore, type JsonStore, type Project } from "./storage/projects";
import type { PipelineEvent, Progress } from "./pipeline/streamVideo";
import type { LLMProvider } from "./llm/provider";
import { giphyKey, giphySearch } from "./media/giphy";
import { devlog } from "./devlog";
import { AUDIO_URL, scene, timeline } from "./stage/demo";

type Screen =
  | { s: "home" } | { s: "settings" }
  | { s: "project"; project: Project }
  | { s: "generate"; args: GenerateArgs; attempt: number }
  | { s: "watch"; video: VideoBundle; project?: Project }
  | { s: "demo" };

const isTauri = () => "__TAURI_INTERNALS__" in window;
const pickPdf = async () => {
  if (!isTauri()) return null;
  const p = await open({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof p === "string" ? p : null;
};
/** The hand-made Heapify scene as a one-scene bundle: one player path for everything. */
const demoBundle = (): VideoBundle => ({
  id: "demo", title: "Heapify", createdAt: 0, complete: true, source: { pdfPath: "", sectionId: "", sectionTitle: "Heapify" },
  scenes: [{ sceneId: "demo", scene, timeline, audioFile: new URL(AUDIO_URL, location.href).href, durationSec: timeline.totalSec }],
});

export default function App({ provider, store = tauriJsonStore, videoStore = tauriVideoStore, initial = { s: "home" } }: { provider?: LLMProvider; store?: JsonStore; videoStore?: VideoStore; initial?: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);
  const home = () => setScreen({ s: "home" });
  const toProject = async (id?: string) => {
    const p = id && (await projects(store).list()).find(x => x.id === id);
    if (p) setScreen({ s: "project", project: p }); else home();
  };
  const pinNote = (projectId: string | undefined, video: { id: string; title: string }) => projectId ? async (text: string, t: number) => {
    const p = (await projects(store).list()).find(x => x.id === projectId);
    if (p) await projects(store).save({ ...p, notes: [{ id: newId("n"), text, createdAt: Date.now(), from: { videoId: video.id, videoTitle: video.title, t } }, ...p.notes] });
  } : undefined;

  switch (screen.s) {
    case "settings": return <Settings onBack={home} />;
    case "demo": return <Watch video={demoBundle()} provider={provider} store={store} onBack={home} />;
    case "watch": return <Watch video={screen.video} provider={provider} store={store} onBack={() => toProject(screen.video.projectId)}
      onPinNote={pinNote(screen.video.projectId, screen.video)} />;
    case "generate": return <Generate key={screen.attempt} args={screen.args} provider={provider} store={store} videoStore={videoStore}
      onRetry={() => setScreen({ ...screen, attempt: screen.attempt + 1 })} onBack={() => toProject(screen.args.project.id)} pinNote={pinNote} />;
    case "project": return <ProjectWithPractice project={screen.project} store={store} videoStore={videoStore} onBack={home}
      onGenerate={args => setScreen({ s: "generate", args, attempt: 0 })} onOpenVideo={video => setScreen({ s: "watch", video })} />;
    default: return <>
      <Home store={store} videoStore={videoStore} onOpenProject={project => setScreen({ s: "project", project })} onOpenVideo={video => setScreen({ s: "watch", video })} onDemo={() => setScreen({ s: "demo" })} />
      <button type="button" aria-label="Settings" onClick={() => setScreen({ s: "settings" })} className="fixed top-4 right-4 grid size-11 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg"><Icon icon={Settings01Icon} /></button>
    </>;
  }
}

function ProjectWithPractice(props: { project: Project; store: JsonStore; videoStore: VideoStore; onBack: () => void; onGenerate: (a: GenerateArgs) => void; onOpenVideo: (v: VideoBundle) => void }) {
  const [practice, setPractice] = useState<PracticeItem[]>([]);
  useEffect(() => {
    let live = true;
    void props.videoStore.list().then(async vs => {
      const items: PracticeItem[] = [];
      for (const v of vs.filter(v => v.projectId === props.project.id)) {
        const done = await results(props.store).get(v.id).catch(() => ({}) as Record<string, { correct: boolean }>);
        for (const cp of v.checkpoints ?? []) items.push({ videoTitle: v.title, prompt: cp.prompt, correct: done[cp.id]?.correct });
      }
      if (live) setPractice(items);
    }, () => {});
    return () => { live = false; };
  }, [props.project.id, props.store, props.videoStore]);
  return <ProjectPage project={props.project} store={props.store} videoStore={props.videoStore} pickPdf={pickPdf}
    loadSections={(source, onProgress) => loadSections(source, onProgress, props.store)}
    onGenerate={props.onGenerate} onOpenVideo={props.onOpenVideo} onBack={props.onBack} practice={practice} />;
}

function Watch({ video, provider, store, onBack, onPinNote }: { video: VideoBundle; provider?: LLMProvider; store: JsonStore; onBack: () => void; onPinNote?: (text: string, t: number) => void }) {
  const stream = useMemo(() => replayStream(video), [video]);
  return <PlayerScreen stream={stream} title={video.title} kicker={video.source.sectionTitle !== video.title ? video.source.sectionTitle : "Tangent"} videoId={video.id === "demo" ? undefined : video.id}
    section={video.title} provider={provider} store={store} autoPlay onBack={onBack} onPinNote={onPinNote} />;
}

/** Read the section, start the pipeline, record it into a bundle, and play it as it streams. */
function Generate({ args, provider, store, videoStore, onRetry, onBack, pinNote }: {
  args: GenerateArgs; provider?: LLMProvider; store: JsonStore; videoStore: VideoStore; onRetry: () => void; onBack: () => void;
  pinNote: (projectId: string | undefined, v: { id: string; title: string }) => ((text: string, t: number) => void) | undefined;
}) {
  const [videoId] = useState(() => newId("v"));
  const [progress, setProgress] = useState<Progress>();
  const [state, setState] = useState<{ stream: AsyncIterable<PipelineEvent>; markdown: string } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const ir = await loadIr(args.source, undefined, store);
        const markdown = stripWatermarks(await sectionText(ir, args.sectionId));
        if (controller.signal.aborted) return;
        const key = await giphyKey();
        const stream = startSession({
          irSection: { markdown, figures: sectionFigures(ir, args.sectionId), exercises: sectionExercises(ir, args.sectionId) },
          provider, signal: controller.signal, gifSearch: key ? giphySearch(key) : null,
          onStatus: s => devlog(`status ${s}`), onProgress: p => { if (!controller.signal.aborted) setProgress(p); },
        });
        setState({ markdown, stream: recordStream(stream, { id: videoId, title: args.title, projectId: args.project.id, source: { pdfPath: args.source.pdfPath, sectionId: args.sectionId, sectionTitle: args.title } }, videoStore, e => devlog(`video save failed ${String(e)}`)) });
      } catch (e) { if (!controller.signal.aborted) setState({ error: String(e) }); }
    })();
    return () => controller.abort();
  }, [args, provider, store, videoStore, videoId]);
  const empty = useMemo(() => (async function* () {})(), []);
  const error = state && "error" in state ? state.error : null;
  return <PlayerScreen stream={state && "stream" in state ? state.stream : empty} key={state && "stream" in state ? "live" : "wait"} title={args.title} kicker={`${args.project.emoji} ${args.project.name}`}
    videoId={videoId} section={state && "markdown" in state ? state.markdown : ""} provider={provider} store={store} progress={progress}
    onRetry={onRetry} onBack={onBack} onPinNote={pinNote(args.project.id, { id: videoId, title: args.title })} autoPlay
    initialError={error ? `Couldn't start this section: ${error}` : undefined} />;
}
