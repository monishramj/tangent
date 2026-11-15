import { expect, it } from "vitest";
import { sceneTransition, SCENE_TRANSITION_SEC } from "./transition";

it("slides and cross-fades solely from incoming audio time, including seek and paused redraws", () => {
  expect(sceneTransition(0)).toEqual({ incoming: { x: 1, opacity: 0 }, outgoing: { x: -0, opacity: 1 } });
  expect(sceneTransition(.2)).toEqual({ incoming: { x: .5, opacity: .5 }, outgoing: { x: -.5, opacity: .5 } });
  for (const t of [.1, .3]) {
    const state = sceneTransition(t);
    expect(state.incoming.opacity + state.outgoing.opacity).toBe(1);
    expect(state.incoming.x - state.outgoing.x).toBe(1);
    sceneTransition(10); sceneTransition(0); // seek away and rejoin
    expect(sceneTransition(t)).toEqual(state);
    expect(sceneTransition(t)).toEqual(state); // paused clock
  }
  for (const t of [SCENE_TRANSITION_SEC, 4, 0.4])
    expect(sceneTransition(t)).toEqual({ incoming: { x: 0, opacity: 1 }, outgoing: { x: -1, opacity: 0 } });
});
