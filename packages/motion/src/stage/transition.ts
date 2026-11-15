import { clamp01, ease } from "./motion";

export const SCENE_TRANSITION_SEC = .4;
export type SceneFrame = { x: number; opacity: number };
/** Incoming scene's audio time is the only input: pause and seek need no transition state. */
export function sceneTransition(t: number): { incoming: SceneFrame; outgoing: SceneFrame } {
  const p = ease(clamp01(t / SCENE_TRANSITION_SEC), "inOutCubic");
  return { incoming: { x: 1 - p, opacity: p }, outgoing: { x: -p, opacity: 1 - p } };
}
