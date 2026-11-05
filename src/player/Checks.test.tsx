import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Checks from "./Checks";
import type { Checkpoint } from "@/gen/checkpoints";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

const cp = (id: string, afterScene: number, prompt: string): Checkpoint =>
  ({ id, afterScene, kind: "mcq", prompt, choices: ["a", "b"], answer: "a", explanation: "x", source: "textbook" });
const all = [cp("c1", 0, "One?"), cp("c2", 0, "Two?"), cp("c3", 1, "Three?"), cp("c4", 2, "Four?")];
const base = { onOpen: vi.fn(), onQuiz: vi.fn(), isReady: () => true, complete: false };

it("says when there are no checks yet", () => {
  render(<Checks {...base} checkpoints={[]} status={{}} />);
  expect(screen.getByText(/once the video's questions are ready/)).toBeTruthy();
});

it("groups checkpoints by scene in order with status and score; ready ones open, others are disabled", () => {
  const onOpen = vi.fn();
  render(<Checks {...base} checkpoints={all} status={{ c1: "right", c2: "wrong", c3: "skipped" }} active="c2" onOpen={onOpen} isReady={c => c.afterScene < 2} />);
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual(["After scene 1", "After scene 2", "After scene 3"]);
  const first = within(screen.getByRole("region", { name: "After scene 1" })).getAllByRole("button");
  expect(first.map(c => c.getAttribute("aria-label"))).toEqual(["Checkpoint 1: One? (right)", "Checkpoint 2: Two? (wrong)"]);
  expect(first[1].getAttribute("aria-current")).toBe("true");
  const later = screen.getByRole("button", { name: "Checkpoint 4: Four? (upcoming)" }) as HTMLButtonElement;
  expect(later.disabled).toBe(true);
  expect(later.textContent).toContain("Not generated yet");
  expect(screen.getByLabelText("1 of 4 right")).toBeTruthy();
  expect(screen.getByText("2 answered")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Checkpoint 3: Three? (skipped)" }));
  expect(onOpen).toHaveBeenCalledWith(all[2]);
});

it("Take the quiz counts what is ready, and is disabled when nothing is", () => {
  const onQuiz = vi.fn();
  const { rerender } = render(<Checks {...base} onQuiz={onQuiz} checkpoints={all} status={{}} isReady={c => c.afterScene < 1} />);
  const btn = screen.getByRole("button", { name: /Take the quiz/ });
  expect(btn.textContent).toContain("2 of 4 ready");
  fireEvent.click(btn);
  expect(onQuiz).toHaveBeenCalledTimes(1);
  rerender(<Checks {...base} onQuiz={onQuiz} checkpoints={all} status={{}} isReady={() => false} />);
  expect((screen.getByRole("button", { name: /Take the quiz/ }) as HTMLButtonElement).disabled).toBe(true);
});
