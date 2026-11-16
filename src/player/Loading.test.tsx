import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Progress } from "@/pipeline/streamVideo";
import Loading, { generationPercent, stageLabel, useGenerationPercent } from "./Loading";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const prog = (o: Partial<Progress> = {}): Progress => ({ step: "script", scene: 0, scenesReady: 0, scenesTotal: 0, beats: [], ...o });

it("weights script at 20%, then narration at 60% of each scene and animation at 40%", () => {
  expect(generationPercent()).toBe(0);
  expect(generationPercent(prog({ step: "formulas" }))).toBe(0);
  expect(generationPercent(prog())).toBe(0);
  expect(generationPercent(prog({ step: "narration", scenesTotal: 4 }))).toBe(20);
  expect(generationPercent(prog({ step: "animation", scenesTotal: 4 }))).toBe(32);
  expect(generationPercent(prog({ step: "ready", scenesTotal: 4, scenesReady: 1 }))).toBe(40);
  expect(generationPercent(prog({ step: "ready", scenesTotal: 4, scenesReady: 4 }))).toBe(99);
  expect(generationPercent(prog(), 99, true)).toBe(100);
});

it("never decreases when totals grow, concurrent steps interleave, or a scene retries", () => {
  let previous = 0;
  for (const progress of [prog(), prog({ step: "animation", scenesTotal: 1 }),
    prog({ step: "narration", scene: 2, scenesTotal: 8 }),
    prog({ step: "ready", scenesReady: 1, scenesTotal: 8 }),
    prog({ step: "narration", scenesReady: 1, scenesTotal: 8 }),
    prog({ step: "ready", scenesReady: 8, scenesTotal: 8 })]) {
    const next = generationPercent(progress, previous);
    expect(next).toBeGreaterThanOrEqual(previous);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThanOrEqual(100);
    previous = next;
  }
  expect(generationPercent(prog({ step: "ready", scenesReady: -5, scenesTotal: 4 }), -10)).toBe(20);
  expect(generationPercent(prog(), 200)).toBe(100);
});

it("retains percentage across waits while the loader is unmounted", () => {
  function Fixture({ progress, waiting }: { progress: Progress; waiting: boolean }) {
    const percent = useGenerationPercent(progress);
    return waiting ? <Loading progress={progress} percent={percent} compact /> : null;
  }
  const view = render(<Fixture waiting progress={prog({ step: "animation", scenesTotal: 1 })} />);
  expect(screen.getByText("Updating video · 68%")).toBeTruthy();
  view.rerender(<Fixture waiting={false} progress={prog({ step: "narration", scenesTotal: 8 })} />);
  view.rerender(<Fixture waiting progress={prog({ step: "narration", scene: 1, scenesTotal: 8 })} />);
  expect(screen.getByText("Updating video · 68%")).toBeTruthy();
  expect(screen.getByText("Narrating scene 2 of 8")).toBeTruthy();
});

it("centers the drawn ring, shows generation copy and uses tabular figures", () => {
  const view = render(<Loading progress={prog()} percent={0} />);
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.className).toContain("inset-0");
  expect(status.className).toContain("place-items-center");
  expect(screen.getByText("Generating video · 0%").className).toContain("tabular-nums");
  expect(screen.getByText("Writing script")).toBeTruthy();
  expect(stageLabel(prog({ step: "formulas", formulas: 12 }))).toBe("Reading formulas · 12");
  expect(stageLabel(prog({ step: "animation" }))).toBe("Building scenes");
  view.rerender(<Loading compact />);
  expect(status.textContent).toBe("Updating video");
});

it("reduced motion holds the ring still", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  render(<Loading />);
  expect(screen.getByTestId("player-ring").getAttribute("data-reduced")).toBe("true");
});
