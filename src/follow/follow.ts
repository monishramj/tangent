import type { BBox } from "./types";

export const initialFollow = { following: true, beat: -1, seq: 0 };
type Action = { type: "beat"; beat: number; hasBoxes: boolean } | { type: "userScroll" } | { type: "backToCurrent" };

export function followReducer(state: typeof initialFollow, action: Action): typeof initialFollow {
  switch (action.type) {
    case "beat": return action.beat === state.beat ? state : { ...state, beat: action.beat, seq: state.seq + (state.following && action.hasBoxes ? 1 : 0) };
    case "userScroll": return state.following ? { ...state, following: false } : state;
    case "backToCurrent": return { ...state, following: true, seq: state.seq + 1 };
  }
}

export const showBackButton = (state: typeof initialFollow, hasBoxes: boolean) => !state.following && hasBoxes;

export function overlayRect(bbox: BBox, { width, height }: { width: number; height: number }, padPx = 4) {
  const left = Math.max(0, bbox[0] * width - padPx), top = Math.max(0, bbox[1] * height - padPx);
  return { left, top, width: Math.min(width, bbox[2] * width + padPx) - left, height: Math.min(height, bbox[3] * height + padPx) - top };
}

export const scrollTarget = (pageTop: number, pageHeightPx: number, bbox: BBox, viewportH: number) => Math.max(0, pageTop + pageHeightPx * bbox[1] - viewportH / 3);

export function fitColumn(boxes: BBox[]) {
  const body = boxes.filter(b => b.every(Number.isFinite) && b[0] >= 0 && b[2] <= 1 && b[2] - b[0] > 0.15);
  if (!body.length) return { zoom: 1, x0: 0 };
  const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
  const x0 = percentile(body.map(b => b[0]), 0.1);
  const width = percentile(body.map(b => b[2] - b[0]), 0.9);
  // shortcut: narrow body boxes imply columns; revisit if margin notes dominate a book's passages.
  const columnWidth = width < 0.5 ? width : percentile(body.map(b => b[2]), 0.9) - x0;
  return { zoom: Math.max(1, Math.min(3, 0.94 / columnWidth)), x0 };
}

export const scrollTargetX = (pageLeft: number, pageWidth: number, bbox: BBox, viewportW: number) =>
  Math.max(0, Math.min(pageLeft + pageWidth * (bbox[0] + bbox[2]) / 2 - viewportW / 2, pageLeft + pageWidth * bbox[0] - 12));
