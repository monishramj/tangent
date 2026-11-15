import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Progress } from "@/pipeline/streamVideo";
import Loading, { loadingFraction } from "./Loading";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const prog = (o: Partial<Progress> = {}): Progress => ({ step: "script", scene: 0, scenesReady: 0, scenesTotal: 0, beats: [], ...o });

const EXP = [250, 120, 15, 45];
it("loadingFraction is monotonic within a step, across steps, and below 1 until ready", () => {
  const secs = [0, 1, 5, 20, 60, 600, 1e6];
  let prev = -1;
  for (const step of [0, 1, 2, 3]) {
    for (const s of secs) {
      const f = loadingFraction(step, s, EXP);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThan(1);
      prev = f;
    }
  }
  expect(loadingFraction(4, 0, EXP)).toBe(1);
});

it("a step never ends above where the next one starts", () => {
  for (const step of [0, 1, 2, 3]) expect(loadingFraction(step, 1e9, EXP)).toBeLessThanOrEqual(loadingFraction(step + 1, 0, EXP));
});

it("bar width follows expected time: a long formula step takes most of the bar", () => {
  expect(loadingFraction(1, 0, EXP)).toBeCloseTo(250 / 430);
  expect(loadingFraction(0, 125, EXP)).toBeCloseTo(125 / 430);
});

it("shows the formula step with its count, then keeps it checked once the script starts", () => {
  const view = render(<Loading progress={prog({ step: "formulas", formulas: 78 })} />);
  expect(screen.getByText("Reading formulas…")).toBeTruthy();
  expect(screen.getByText(/· 78/)).toBeTruthy();
  expect(screen.getByText(/left$/)).toBeTruthy();
  view.rerender(<Loading progress={prog()} />);
  expect(screen.getByText("Writing the script…")).toBeTruthy();
  expect(screen.getByText(/· 78/)).toBeTruthy();
});

it("past the estimate the bar holds and the label says how long it has been", () => {
  render(<Loading progress={prog()} />);
  act(() => { vi.advanceTimersByTime(10 * 60_000); });
  expect(screen.getByText(/taking longer than usual · 10 min/)).toBeTruthy();
  expect(value()).toBeLessThan(100);
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
