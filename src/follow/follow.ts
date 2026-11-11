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
