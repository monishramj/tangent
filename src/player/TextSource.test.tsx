import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Timeline } from "@motion/dsl/compile";
import TextSource from "./TextSource";

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

const tl = { events: [{ start: 0, end: 1, verb: "say", beat: 0, args: {} }, { start: 2, end: 3, verb: "say", beat: 1, args: {} }], totalSec: 4, insertedSilences: [] } as unknown as Timeline;
const passages = [{ id: "p1", markdown: "A heap is a tree." }, { id: "p2", markdown: "Sift the root down." }];
const scenes = [{ timeline: tl, passageIds: [["p1"], ["p2"]] }];

it("highlights the passage the current beat rewrites and follows it", () => {
  const view = render(<TextSource passages={passages} scenes={scenes} time={0.5} />);
  expect(screen.getByTestId("passage-highlight").textContent).toBe("A heap is a tree.");
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  view.rerender(<TextSource passages={passages} scenes={scenes} time={2.5} />);
  expect(screen.getByTestId("passage-highlight").textContent).toBe("Sift the root down.");
  fireEvent.wheel(screen.getByLabelText("Source text"), { deltaY: 40 });
  expect(screen.getByRole("button", { name: "Back to current" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to current" }));
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  expect(screen.getByTestId("passage-highlight").textContent).toBe("Sift the root down.");
});

it("labels transcribed photo text while retaining passage highlights", () => {
  render(<TextSource passages={passages} scenes={scenes} time={0.5} transcribed />);
  expect(screen.getByText("transcribed, check against your notes")).toBeTruthy();
  expect(screen.getByTestId("passage-highlight").textContent).toBe("A heap is a tree.");
});
