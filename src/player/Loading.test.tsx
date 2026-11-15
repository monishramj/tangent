import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Progress } from "@/pipeline/streamVideo";
import Loading from "./Loading";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const prog = (o: Partial<Progress> = {}): Progress => ({ step: "script", scene: 0, scenesReady: 0, scenesTotal: 0, beats: [], ...o });
const motion = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({
  matches, media: "(prefers-reduced-motion: reduce)",
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null,
}));

it("first-scene wait shows the drawn ring and the pipeline stage", () => {
  motion(false);
  const view = render(<Loading />);
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.className).toContain("absolute");
  expect(status.textContent).toBe("Preparing your explanation");
  expect(screen.getByTestId("player-ring").getAttribute("data-reduced")).toBe("false");
  view.rerender(<Loading progress={prog({ step: "formulas", formulas: 12 })} />);
  expect(screen.getByRole("status").textContent).toBe("Reading formulas · 12");
  view.rerender(<Loading progress={prog()} />);
  expect(screen.getByRole("status").textContent).toBe("Writing the script");
  view.rerender(<Loading progress={prog({ step: "narration" })} />);
  expect(screen.getByRole("status").textContent).toBe("Narrating");
  view.rerender(<Loading progress={prog({ step: "animation" })} />);
  expect(screen.getByRole("status").textContent).toBe("Animating the first scene");
});

it("buffering mid-video names the next scene and clamps at the last one", () => {
  motion(false);
  const view = render(<Loading compact progress={prog({ step: "animation", scenesReady: 1, scenesTotal: 4 })} />);
  expect(screen.getByRole("status").textContent).toBe("Waiting for scene 2 of 4");
  view.rerender(<Loading compact progress={prog({ step: "ready", scenesReady: 4, scenesTotal: 4 })} />);
  expect(screen.getByRole("status").textContent).toBe("Buffering");
  view.rerender(<Loading compact />);
  expect(screen.getByRole("status").textContent).toBe("Buffering");
});

it("reduced motion holds the ring still", () => {
  motion(true);
  render(<Loading progress={prog()} />);
  expect(screen.getByTestId("player-ring").getAttribute("data-reduced")).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("Writing the script");
});
