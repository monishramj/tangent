import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { pdfPage } from "@/home/api";
import { boxesAt, hasPassages } from "@/follow/passages";
import { followReducer, initialFollow, overlayRect, scrollTarget, showBackButton } from "@/follow/follow";
import type { FollowScene, PageImage, PassageBox, RenderPage, TextbookSource } from "@/follow/types";

export default function Textbook({ source, scenes, time, renderPage = pdfPage }: {
  source: TextbookSource; scenes: FollowScene[]; time: number; renderPage?: RenderPage;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, dispatch] = useReducer(followReducer, initialFollow);
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
  useEffect(() => { dispatch({ type: "beat", beat: current.beat, hasBoxes: current.boxes.length > 0 }); }, [current.beat, current.boxes.length]);
  useEffect(() => {
    const box = currentRef.current.boxes[0], root = scroller.current;
    if (!box || !root || !follow.seq) return;
    const page = root.querySelector<HTMLElement>(`[data-page="${box.page}"]`);
    if (!page) return;
    const rect = page.getBoundingClientRect();
    root.scrollTo({ top: scrollTarget(rect.top - root.getBoundingClientRect().top + root.scrollTop, rect.height, box.bbox, root.clientHeight), behavior: "smooth" });
  }, [follow.seq]);
  const stop = () => { if (mapped) dispatch({ type: "userScroll" }); };
  return <div className="relative min-h-0 flex-1">
    <div ref={scroller} aria-label="Textbook pages" tabIndex={0} className="h-full overflow-y-auto px-3 pb-16"
      onWheel={stop} onTouchMove={stop} onPointerDown={stop} onKeyDown={e => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) { stop(); e.stopPropagation(); }
      }}>
      {pages.map((page, i) => <Page key={`${source.pdfPath}:${page}`} path={source.pdfPath} page={page} first={i === 0} aspect={aspect}
        onAspect={setAspect} root={scroller} renderPage={renderPage} boxes={current.boxes.filter(b => b.page === page)} />)}
    </div>
    {showBackButton(follow, mapped && current.boxes.length > 0) && <button type="button" onClick={() => dispatch({ type: "backToCurrent" })}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-fg/20 bg-bg px-4 py-2 text-sm text-fg shadow-lg transition-transform active:scale-95">Back to current</button>}
  </div>;
}

function Page({ path, page, first, aspect, onAspect, root, renderPage, boxes }: {
  path: string; page: number; first: boolean; aspect: number; onAspect: (n: number) => void;
  root: React.RefObject<HTMLDivElement | null>; renderPage: RenderPage; boxes: PassageBox[];
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(first);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState<PageImage>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = wrapper.current!;
    const measure = () => { const { width, height } = node.getBoundingClientRect(); setSize(s => s.width === width && s.height === height ? s : { width, height }); };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setVisible(true); }, { root: root.current, rootMargin: "600px" });
    observer.observe(node);
    return () => { resize.disconnect(); observer.disconnect(); };
  }, [root]);
  // Rendered in 400 px steps: the panel animates its width open, and every resize tick must not re-render the page.
  const widthPx = Math.min(4000, Math.ceil((size.width || root.current?.clientWidth || 360) * (window.devicePixelRatio || 1) / 400) * 400);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setError(false);
    void renderPage(path, page, widthPx).then(result => {
      if (!live) return;
      setImage(result);
      if (first) onAspect(result.width / result.height);
    }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [visible, path, page, widthPx, renderPage, first, onAspect]);
  return <div ref={wrapper} data-page={page} className="relative mb-3 w-full overflow-hidden rounded-sm border border-line bg-fg/5"
    style={{ aspectRatio: image ? image.width / image.height : aspect }}>
    {image && <img alt={`Page ${page}`} src={image.url} className="block size-full" />}
    {error && <p role="status" className="p-4 text-center text-sm text-muted">Couldn't load page {page}.</p>}
    {boxes.map((box, i) => <div key={i} data-testid="passage-highlight" className="pointer-events-none absolute rounded-sm bg-black/[.07] ring-2 ring-black/75 transition-opacity duration-150"
      style={overlayRect(box.bbox, size)} />)}
  </div>;
}
