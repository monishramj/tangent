import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Timeline } from "@motion/dsl/compile";
import type { RenderPage } from "@/follow/types";
import SourceFollow, { panelSource } from "./SourceFollow";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.scrollTo ??= function () {};
afterEach(cleanup);

const tl = { events: [{ start: 0, end: 1, verb: "say", beat: 0, args: {} }, { start: 2, end: 3, verb: "say", beat: 1, args: {} }], totalSec: 4, insertedSilences: [] } as unknown as Timeline;
const renderPage = vi.fn<RenderPage>(async () => ({ url: "data:image/png;base64,aa", width: 10, height: 10 }));

it("switches the follow panel to the beat's source", () => {
  const sources = [
    { id: "a", pdfPath: "/book.pdf", pages: [1], passages: [] },
    { id: "b", pdfPath: "/deck.pptx", pages: [], passages: [{ id: "b/p1", markdown: "Slide text", boxes: [] }] },
  ];
  const scenes = [{ scene: { beats: [{}, {}] }, timeline: tl, sourceIds: ["a", "b"], passageIds: [[], ["b/p1"]] }];
  const view = render(<SourceFollow sources={sources} scenes={scenes} time={0.5} renderPage={renderPage} />);
  expect(screen.getByLabelText("Textbook pages")).toBeTruthy();
  expect(screen.queryByLabelText("Source text")).toBeNull();
  view.rerender(<SourceFollow sources={sources} scenes={scenes} time={2.5} renderPage={renderPage} />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByText("Slide text")).toBeTruthy();
  expect(screen.queryByLabelText("Textbook pages")).toBeNull();
  fireEvent.wheel(screen.getByLabelText("Source text"), { deltaY: 20 });
});

it("shows a placeholder instead of another source when this beat's source is missing", () => {
  const sources = [
    { id: "a", pdfPath: "/book.pdf", pages: [3], passages: [], missing: true },
    { id: "b", pdfPath: "/deck.pptx", pages: [], passages: [{ id: "b/p1", markdown: "Slide text", boxes: [] }] },
  ];
  const scenes = [{ scene: { beats: [{}, {}] }, timeline: tl, sourceIds: ["a", "b"], passageIds: [[], ["b/p1"]] }];
  renderPage.mockClear();
  const view = render(<SourceFollow sources={sources} scenes={scenes} time={0.5} renderPage={renderPage} />);
  expect(screen.getByLabelText("Source text").textContent).toMatch(/isn't available/);
  expect(screen.queryByLabelText("Textbook pages")).toBeNull();
  expect(panelSource(sources, "a")).toBeNull();
  view.rerender(<SourceFollow sources={sources} scenes={scenes} time={2.5} renderPage={renderPage} />);
  expect(screen.getByText("Slide text")).toBeTruthy();
  expect(renderPage).not.toHaveBeenCalled();
});
