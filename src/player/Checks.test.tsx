import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Checks from "./Checks";
import type { Checkpoint } from "@/gen/checkpoints";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

const cp = (id: string, afterScene: number, prompt: string): Checkpoint =>
  ({ id, afterScene, kind: "mcq", prompt, choices: ["a", "b"], answer: "a", explanation: "x", source: "textbook" });
const all = [cp("c1", 0, "One?"), cp("c2", 1, "Two?"), cp("c3", 2, "Three?"), cp("c4", 3, "Four?")];

it("renders nothing without checkpoints", () => {
  const { container } = render(<Checks checkpoints={[]} status={{}} onOpen={vi.fn()} isReady={() => true} />);
  expect(container.innerHTML).toBe("");
});

it("lists every checkpoint in order with its status and the score; ready chips open, others are disabled", () => {
  const onOpen = vi.fn();
  render(<Checks checkpoints={all} status={{ c1: "right", c2: "wrong", c3: "skipped" }} active="c2" onOpen={onOpen} isReady={c => c.afterScene < 3} />);
  const chips = screen.getAllByRole("button");
  expect(chips.map(c => c.getAttribute("aria-label"))).toEqual([
    "Checkpoint 1: One? (right)", "Checkpoint 2: Two? (wrong)", "Checkpoint 3: Three? (skipped)", "Checkpoint 4: Four? (upcoming)"]);
  expect(chips[1].getAttribute("aria-current")).toBe("true");
  expect((chips[3] as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText("1 of 4 right")).toBeTruthy();
  fireEvent.click(chips[2]);
  expect(onOpen).toHaveBeenCalledWith(all[2]);
});
