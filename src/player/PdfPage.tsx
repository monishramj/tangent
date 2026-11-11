import { useEffect, useRef, useState } from "react";
import LoadingCircle from "@/components/LoadingCircle";
import { renderBucket } from "@/follow/follow";
import type { PageImage, PassageBox, RenderPage } from "@/follow/types";

export default function Page({ path, page, first, aspect, width, onAspect, root, renderPage, boxes = [] }: {
  path: string; page: number; first: boolean; aspect: number; width: number; onAspect: (n: number) => void;
  root: React.RefObject<HTMLDivElement | null>; renderPage: RenderPage; boxes?: PassageBox[];
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
