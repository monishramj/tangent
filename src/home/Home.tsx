import { useRef, useState } from "react";
import { File02Icon, PlayIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import AnimatedList from "@/components/AnimatedList";
import Icon from "@/components/Icon";
import ShinyText from "@/components/ShinyText";
import { ingestPdf, listSections, type IR, type SectionRef } from "./api";

const KEY = "tangent.recent";
type Recent = { path: string; sectionId: string; title: string };
type State =
  | { s: "idle" }
  | { s: "loading"; name: string }
  | { s: "error"; msg: string }
  | { s: "pick"; path: string; ir: IR; sections: SectionRef[] };

const readRecent = (): Recent[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};
const pages = (a: { page: number }[]) => {
  if (!a.length) return "";
  const [lo, hi] = [Math.min(...a.map((x) => x.page)), Math.max(...a.map((x) => x.page))];
  return lo === hi ? `p. ${lo}` : `pp. ${lo}-${hi}`;
};
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const btn = "flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-fg hover:bg-fg/10";

// ponytail: Tauri 2 webviews give no File.path and the dialog plugin isn't installed, so outside tests the path
// falls back to file.name. Swap pickPath for plugin-dialog / onDragDropEvent when the real pipeline lands.
const pathOf = (f: File) => (f as File & { path?: string }).path ?? f.name;

export default function Home({ onStart = () => {}, onDemo = () => {} }: { onStart?: (sectionId: string, ir: IR) => void; onDemo?: () => void }) {
  const [state, setState] = useState<State>({ s: "idle" });
  const [recent, setRecent] = useState(readRecent);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (path: string, name = path) => {
    setState({ s: "loading", name });
    try {
      const ir = await ingestPdf(path);
      setState({ s: "pick", path, ir, sections: await listSections(ir) });
    } catch (e) {
      setState({ s: "error", msg: String(e) });
    }
  };
  const take = (f?: File) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) return setState({ s: "error", msg: "That isn't a PDF. Choose a .pdf file." });
    load(pathOf(f), f.name);
  };
  const start = (path: string, ir: IR, sectionId: string, title: string) => {
    const next = [{ path, sectionId, title }, ...recent.filter((r) => !(r.path === path && r.sectionId === sectionId))].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(next));
    setRecent(next);
    onStart(sectionId, ir);
  };
  const reopen = async (r: Recent) => {
    setState({ s: "loading", name: r.title });
    try {
      const ir = await ingestPdf(r.path);
      onStart(r.sectionId, ir);
    } catch (e) {
      setState({ s: "error", msg: String(e) });
    }
  };

  return (
    <main className="h-screen overflow-y-auto bg-bg px-8 py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <header>
          <h1 className="text-5xl font-semibold tracking-tight">Tangent</h1>
          <p className="mt-2 text-base text-muted">Drop in a chapter. Pick a section. Watch, and interrupt whenever you like.</p>
        </header>

        {state.s === "pick" ? (
          <section aria-label="Choose a section" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pick a section</h2>
              <button type="button" className={btn} onClick={() => setState({ s: "idle" })}>Choose another PDF</button>
            </div>
            <AnimatedList
              items={state.sections.map((x) => ({ id: x.id, title: x.title, meta: pages(x.anchors) }))}
              ariaLabel="Sections"
              onItemSelect={(_, i) => { const x = state.sections[i]; start(state.path, state.ir, x.id, x.title); }}
              frame={false}
              showGradients={false}
              width="100%"
              maxHeight="none"
              gap={4}
              radius={8}
              itemClassName="min-h-11"
              style={{ "--al-tile": "transparent", "--al-tile-edge": "transparent", "--al-tile-highlight": "transparent", "--al-tile-shadow": "none", "--al-ink": "var(--fg)", "--al-muted": "var(--fg-muted)", "--al-ring": "rgba(255,255,255,0.5)", "--al-ring-fill": "rgba(255,255,255,0.04)", "--al-hover": "none", "--al-active": "none" } as React.CSSProperties}
              renderItem={(_, i) => {
                const x = state.sections[i];
                return (
                  <>
                    <span style={{ paddingLeft: Math.max(0, x.level - 1) * 20 }} className={`flex-1 ${x.level <= 1 ? "text-fg" : "text-muted"}`}>{x.title}</span>
                    <span className="text-xs text-subtle tabular-nums">{pages(x.anchors)}</span>
                  </>
                );
              }}
            />
          </section>
        ) : (
          <div
            data-testid="dropzone"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
            className={`flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center ${over ? "border-fg bg-fg/5" : "border-line"}`}
          >
            {state.s === "loading" ? (
              <p role="status" className="text-base text-muted">
                <ShinyText text={`Reading ${state.name}...`} color={css("--fg-subtle")} shineColor={css("--fg")} />
              </p>
            ) : state.s === "error" ? (
              <>
                <p role="alert" className="text-base text-fg">Couldn't read that PDF: {state.msg}</p>
                <button type="button" className={btn} onClick={() => setState({ s: "idle" })}>Try again</button>
              </>
            ) : (
              <>
                <Icon icon={Upload04Icon} size={32} className="text-subtle" />
                <p className="text-base text-muted">Drop a PDF here</p>
                <button type="button" className={btn} onClick={() => input.current?.click()}>
                  <Icon icon={File02Icon} size={20} />
                  Choose PDF
                </button>
              </>
            )}
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        )}

        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="text-lg font-semibold">Recent videos</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-subtle">No recent videos yet.</p>
          ) : (
            <ul aria-label="Recent videos" className="flex flex-col gap-1">
              {recent.map((r) => (
                <li key={r.path + r.sectionId}>
                  <button type="button" onClick={() => reopen(r)} className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-fg/10">
                    <span className="text-fg">{r.title}</span>
                    <span className="text-xs text-subtle">{r.path.split("/").pop()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onDemo} className={`${btn} self-start`}>
            <Icon icon={PlayIcon} size={20} className="fill-current" />
            Heapify demo
          </button>
        </section>
      </div>
    </main>
  );
}
