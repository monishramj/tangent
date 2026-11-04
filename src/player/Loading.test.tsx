import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Progress } from "@/pipeline/streamVideo";
import Loading, { loadingFraction } from "./Loading";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const prog = (o: Partial<Progress> = {}): Progress => ({ step: "script", scene: 0, scenesReady: 0, scenesTotal: 0, beats: [], ...o });

it("loadingFraction is monotonic within a step, across steps, and below 1 until ready", () => {
  const secs = [0, 1, 5, 20, 60, 600, 1e6];
  let prev = -1;
  for (const step of [0, 1, 2]) {
    for (const s of secs) {
      const f = loadingFraction(step, s);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThan(1);
      prev = f;
    }
  }
  expect(loadingFraction(3, 0)).toBe(1);
});

it("a step never ends above where the next one starts", () => {
  for (const step of [0, 1, 2]) expect(loadingFraction(step, 1e9)).toBeLessThanOrEqual(loadingFraction(step + 1, 0));
});

const value = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

it("the rendered bar never moves backwards as time passes and the step advances", () => {
  const view = render(<Loading progress={prog()} />);
  const seen = [value()];
  const tick = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); seen.push(value()); };
  tick(5000); tick(30000);
  view.rerender(<Loading progress={prog({ step: "narration", scenesTotal: 3, beats: ["a"] })} />);
  seen.push(value()); tick(2000);
  view.rerender(<Loading progress={prog({ step: "animation", scenesTotal: 3, beats: ["a"] })} />);
  seen.push(value()); tick(60000);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  expect(Math.max(...seen)).toBeLessThan(100);
  expect(screen.getByRole("status", { name: "Generation progress" })).toBeTruthy();
});

it("shows the step label and upcoming beats", () => {
  render(<Loading progress={prog({ step: "animation", scenesTotal: 2, beats: ["First idea.", "Second idea."] })} />);
  expect(screen.getByText("Animating the first scene…")).toBeTruthy();
  expect(screen.getByText(/First idea\./)).toBeTruthy();
  expect(screen.getByText(/2 beats, 2 scenes/)).toBeTruthy();
});

it("compact variant reads 'Buffering · scene k of N' and clamps at N", () => {
  const view = render(<Loading compact progress={prog({ step: "animation", scenesReady: 1, scenesTotal: 4 })} />);
  expect(screen.getByRole("status", { name: "Buffering" }).textContent).toBe("Buffering · scene 2 of 4");
  view.rerender(<Loading compact progress={prog({ step: "ready", scenesReady: 4, scenesTotal: 4 })} />);
  expect(screen.getByRole("status", { name: "Buffering" }).textContent).toBe("Buffering · scene 4 of 4");
  view.rerender(<Loading compact />);
  expect(screen.getByRole("status", { name: "Buffering" }).textContent).toBe("Buffering…");
});
