import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import LoadingCircle from "@/components/LoadingCircle";
import Icon from "@/components/Icon";
import { pdfPage } from "@/home/api";
import { boxesAt, hasPassages } from "@/follow/passages";
import { fitColumn, followReducer, initialFollow, renderBucket, scrollTarget, scrollTargetX, showBackButton } from "@/follow/follow";
import type { FollowScene, PageImage, PassageBox, RenderPage, TextbookSource } from "@/follow/types";

export default function Textbook({ source, scenes, time, renderPage = pdfPage }: {
  source: TextbookSource; scenes: FollowScene[]; time: number; renderPage?: RenderPage;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, dispatch] = useReducer(followReducer, initialFollow);
  const panelWidth = useRef(360);
  const fit = useMemo(() => fitColumn(scenes.flatMap(s => s.passages?.flatMap(bs => bs.map(b => b.bbox)) ?? [])), [scenes]);
  const [zoomState, setZoomState] = useState<{ mode: "fit" | "manual"; zoom: number }>({ mode: "fit", zoom: 1 });
  const zoom = zoomState.mode === "fit" ? fit.zoom : zoomState.zoom;
  const [renderWidth, setRenderWidth] = useState(360 * zoom);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const [visiblePage, setVisiblePage] = useState(source.pages[0] ?? 1);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  const modeRef = useRef(zoomState.mode);
  const followingRef = useRef(true);
  const applySize = (value: number, point?: { x: number; y: number }, width = panelWidth.current) => {
    const root = scroller.current;
    if (!root) return;
    const oldWidth = panelWidth.current * zoomRef.current;
    const ratio = width * value / oldWidth;
    const box = currentRef.current.boxes[0];
    const page = box && root.querySelector<HTMLElement>(`[data-page="${box.page}"]`);
    const before = page?.getBoundingClientRect();
    const x = point?.x ?? root.clientWidth / 2, y = point?.y ?? root.clientHeight / 3;
    const left = root.scrollLeft, top = root.scrollTop;
    root.dataset.sizing = "true";
    root.style.setProperty("--page-w", `${width * value}px`);
    panelWidth.current = width;
    zoomRef.current = value;
    // Keep the followed paragraph at the same viewport position; pinch keeps the pointer's content anchored.
    const after = page?.getBoundingClientRect();
    if (!point && followingRef.current && box && before && after) {
      root.scrollTo({ left: left + after.left - before.left + (after.width - before.width) * box.bbox[0],
        top: top + after.top - before.top + (after.height - before.height) * box.bbox[1], behavior: "instant" });
    } else {
      root.scrollTo({ left: (left + x - 12) * ratio - x + 12, top: (top + y) * ratio - y, behavior: "instant" });
    }
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      delete root.dataset.sizing;
      setRenderWidth(panelWidth.current * zoomRef.current);
      setZoomState({ mode: modeRef.current, zoom: zoomRef.current });
    }, 250);
  };
  const changeZoom = (next: number, point?: { x: number; y: number }) => {
    modeRef.current = "manual";
    const value = Math.max(0.5, Math.min(4, next));
    applySize(value, point);
    if (!point) setZoomState({ mode: "manual", zoom: value });
  };
  const applySizeRef = useRef(applySize);
  applySizeRef.current = applySize;
  useEffect(() => {
    const root = scroller.current!;
    const measure = () => {
      if (!frame.current) frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (root.clientWidth) applySizeRef.current(zoomRef.current, undefined, Math.max(1, root.clientWidth - 24));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (modeRef.current !== "manual") setZoomState({ mode: "manual", zoom: zoomRef.current });
      modeRef.current = "manual";
      const rect = root.getBoundingClientRect();
      applySizeRef.current(Math.max(0.5, Math.min(4, zoomRef.current * Math.exp(-e.deltaY * 0.01))), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); root.removeEventListener("wheel", wheel); cancelAnimationFrame(frame.current); clearTimeout(settle.current); };
  }, []);
  useLayoutEffect(() => {
    if (modeRef.current === "fit") applySizeRef.current(fit.zoom);
  }, [fit.zoom]);
  const [aspect, setAspect] = useState(0.75);
  const pages = useMemo(() => {
    const known = [...source.pages, ...scenes.flatMap(s => s.passages?.flatMap(bs => bs.map(b => b.page)) ?? [])];
    const first = known.length ? Math.min(...known) : 1, last = known.length ? Math.max(...known) : 1;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [source.pages, scenes]);
  const current = boxesAt(scenes, time);
  const mapped = hasPassages(scenes);
  const currentRef = useRef(current);
  currentRef.current = current;
  followingRef.current = follow.following;
  useEffect(() => { dispatch({ type: "beat", beat: current.beat, hasBoxes: current.boxes.length > 0 }); }, [current.beat, current.boxes.length]);
  const scrollCurrent = (behavior: ScrollBehavior) => {
    const box = currentRef.current.boxes[0], root = scroller.current;
    if (!box || !root || !follow.following) return;
    const page = root.querySelector<HTMLElement>(`[data-page="${box.page}"]`);
    if (!page) return;
    const rect = page.getBoundingClientRect();
    root.scrollTo({ left: scrollTargetX(rect.left - root.getBoundingClientRect().left + root.scrollLeft, rect.width, box.bbox, root.clientWidth), top: scrollTarget(rect.top - root.getBoundingClientRect().top + root.scrollTop, rect.height, box.bbox, root.clientHeight), behavior });
  };
  useEffect(() => { scrollCurrent("smooth"); }, [follow.seq, follow.following]);
  useLayoutEffect(() => { scrollCurrent("instant"); }, [aspect]);
  const stop = () => { if (mapped) dispatch({ type: "userScroll" }); };
  return <div className="relative min-h-0 min-w-0 flex-1">
    <div ref={scroller} style={{ "--page-w": `${360 * fit.zoom}px` } as React.CSSProperties} aria-label="Textbook pages" tabIndex={0} className="h-full overflow-auto px-3 pb-16 [overflow-anchor:none]"
      onScroll={() => {
        const root = scroller.current!;
        const top = root.getBoundingClientRect().top;
        const page = Array.from(root.querySelectorAll<HTMLElement>("[data-page]")).find(p => p.getBoundingClientRect().bottom > top + 48);
        if (page) setVisiblePage(Number(page.dataset.page));
      }}
      onWheel={e => { if (!e.ctrlKey && !e.metaKey) stop(); }} onTouchMove={stop}
      onPointerDown={e => { pointer.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={e => { const p = pointer.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) { stop(); pointer.current = null; } }}
      onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onKeyDown={e => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) { stop(); e.stopPropagation(); }
      }}>
      {!mapped && <p className="pb-3 pt-14 text-xs text-muted">Highlights appear on videos made after this feature.</p>}
      {pages.map((page, i) => <Page key={`${source.pdfPath}:${page}`} path={source.pdfPath} page={page} first={i === 0} aspect={aspect}
        width={renderWidth} onAspect={setAspect} root={scroller} renderPage={renderPage} boxes={current.boxes.filter(b => b.page === page)} />)}
    </div>
    <div role="toolbar" aria-label="Textbook zoom" className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-fg/20 bg-bg/95 p-1 text-xs text-fg shadow-lg">
      <span className="px-2 tabular-nums">p. {follow.following ? current.boxes[0]?.page ?? visiblePage : visiblePage}</span>
      <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => changeZoom(zoom / 1.25)} className="grid size-8 place-items-center rounded-full hover:bg-fg/10 disabled:opacity-30"><Icon icon={MinusSignIcon} size={16} /></button>
      <span className="min-w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => changeZoom(zoom * 1.25)} className="grid size-8 place-items-center rounded-full hover:bg-fg/10 disabled:opacity-30"><Icon icon={PlusSignIcon} size={16} /></button>
      <button type="button" aria-pressed={zoomState.mode === "fit"} title="Zoom so the text fills the panel" onClick={() => { modeRef.current = "fit"; applySize(fit.zoom); setZoomState({ mode: "fit", zoom: fit.zoom }); }} className={`rounded-full px-3 py-2 ${zoomState.mode === "fit" ? "bg-fg text-bg" : "hover:bg-fg/10"}`}>Fit width</button>
    </div>
    {showBackButton(follow, mapped && current.boxes.length > 0) && <button type="button" onClick={() => dispatch({ type: "backToCurrent" })}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-fg/20 bg-bg px-4 py-2 text-sm text-fg shadow-lg transition-transform active:scale-95">Back to current</button>}
  </div>;
}

function Page({ path, page, first, aspect, width, onAspect, root, renderPage, boxes }: {
  path: string; page: number; first: boolean; aspect: number; width: number; onAspect: (n: number) => void;
  root: React.RefObject<HTMLDivElement | null>; renderPage: RenderPage; boxes: PassageBox[];
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(first);
  const [image, setImage] = useState<PageImage>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = wrapper.current!;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setVisible(true); }, { root: root.current, rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);
  // Keep the previous image scaled by CSS while a sharper settled bucket loads.
  const loadedWidth = useRef(0);
  const widthPx = renderBucket(width, window.devicePixelRatio || 1, loadedWidth.current);
  useEffect(() => {
    if (!visible || widthPx <= loadedWidth.current) return;
    let live = true;
    setError(false);
    void renderPage(path, page, widthPx).then(result => {
      if (!live) return;
      loadedWidth.current = widthPx;
      setImage(result);
      if (first) onAspect(result.width / result.height);
    }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [visible, path, page, widthPx, renderPage, first, onAspect]);
  return <div ref={wrapper} data-page={page} className="relative mb-3 w-full overflow-hidden rounded-sm border border-line bg-fg/5"
    style={{ width: "var(--page-w)", aspectRatio: image ? image.width / image.height : aspect }}>
    {image && <img alt={`Page ${page}`} src={image.url} className="block size-full" />}
    {!image && !error && <LoadingCircle label={`Loading page ${page}`} />}
    {error && <p role="status" className="absolute inset-x-0 bottom-0 bg-bg/90 p-4 text-center text-sm text-muted">Couldn't load page {page}.</p>}
    {boxes.map((box, i) => <div key={i} data-testid="passage-highlight" className="passage-highlight pointer-events-none absolute rounded-sm bg-black/[.07] ring-2 ring-black/75 transition-[left,top,right,bottom,opacity] duration-200 motion-reduce:transition-none"
      style={{ left: `max(0px, calc(${box.bbox[0] * 100}% - 4px))`, top: `max(0px, calc(${box.bbox[1] * 100}% - 4px))`,
        right: `max(0px, calc(${(1 - box.bbox[2]) * 100}% - 4px))`, bottom: `max(0px, calc(${(1 - box.bbox[3]) * 100}% - 4px))` }} />)}
  </div>;
}
