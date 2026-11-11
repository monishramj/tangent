// UI package: the Textbook side-panel tab (docs/textbook-follow.md).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Timeline } from "@motion/dsl/compile";
import type { BBox, FollowScene, RenderPage } from "@/follow/types";
import Textbook from "./Textbook";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
Element.prototype.scrollTo ??= function () {};
afterEach(cleanup);

const tl = (totalSec: number) => ({ events: [{ start: 0, end: 1, verb: "say", beat: 0, args: {} }, { start: 2, end: 3, verb: "say", beat: 1, args: {} }], totalSec, insertedSilences: [] }) as unknown as Timeline;
const box = (page: number) => ({ page, bbox: [0.1, 0.2, 0.9, 0.3] as BBox });
const mapped: FollowScene[] = [{ scene: { beats: [{}, {}] }, timeline: tl(4), passages: [[box(12)], [box(13)]] }];
const old: FollowScene[] = [{ scene: { beats: [{}, {}] }, timeline: tl(4) }];
const renderPage = vi.fn<RenderPage>(async (_path, page) => ({ url: `data:image/png;base64,${page}`, width: 600, height: 800 }));
const source = { pdfPath: "/book.pdf", pages: [12, 13] };

it("renders the section's pages from the PDF and highlights the current beat's passage", async () => {
  render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(0));
  expect(renderPage).toHaveBeenCalledWith("/book.pdf", 12, expect.any(Number));
  expect(screen.getByAltText("Page 12")).toBeTruthy();
  const marks = screen.getAllByTestId("passage-highlight");
  expect(marks).toHaveLength(1);
  expect(marks[0].closest("[data-page]")?.getAttribute("data-page")).toBe("12");
});

it("moves the highlight with playback", async () => {
  const { rerender } = render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  rerender(<Textbook source={source} scenes={mapped} time={2.5} renderPage={renderPage} />);
  await waitFor(() => expect(screen.getAllByTestId("passage-highlight")[0].closest("[data-page]")?.getAttribute("data-page")).toBe("13"));
});

it("a user scroll stops following and shows Back to current; clicking it resumes", async () => {
  render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  fireEvent.wheel(screen.getByLabelText("Textbook pages"), { deltaY: 200 });
  const back = await screen.findByRole("button", { name: "Back to current" });
  act(() => { back.click(); });
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
});

it("old bundles: shows the section's pages with no highlight and no Back button", async () => {
  render(<Textbook source={source} scenes={old} time={0.5} renderPage={renderPage} />);
  await waitFor(() => expect(screen.getByAltText("Page 12")).toBeTruthy());
  expect(screen.queryAllByTestId("passage-highlight")).toHaveLength(0);
  expect(screen.getByText("Highlights appear on videos made after this feature.")).toBeTruthy();
  fireEvent.wheel(screen.getByLabelText("Textbook pages"), { deltaY: 200 });
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
});

it("with no known pages and no mapping, falls back to page 1", async () => {
  render(<Textbook source={{ pdfPath: "/book.pdf", pages: [] }} scenes={old} time={0} renderPage={renderPage} />);
  await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
});


it("zoom controls scale page widths and Fit restores the computed column zoom", async () => {
  const { container } = render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  await screen.findByAltText("Page 12");
  const page = container.querySelector<HTMLElement>('[data-page="12"]')!;
  const fitted = parseFloat(page.style.width);
  expect(fitted).toBeCloseTo(360 * 0.94 / 0.8);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(parseFloat(page.style.width)).toBeCloseTo(fitted * 1.25);
  expect(screen.getByRole("button", { name: "Fit" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(parseFloat(page.style.width)).toBeCloseTo(fitted);
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(parseFloat(page.style.width)).toBeCloseTo(fitted);
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  expect(screen.getByRole("button", { name: "Fit" }).getAttribute("aria-pressed")).toBe("true");
});

it("a plain page click keeps following, while dragging stops it", () => {
  render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  const root = screen.getByLabelText("Textbook pages");
  fireEvent.pointerDown(root, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(root, { clientX: 20, clientY: 20 });
  fireEvent.click(root);
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  // jsdom lacks PointerEvent coordinates; MouseEvent supplies the same pointer geometry.
  fireEvent(root, new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
  fireEvent(root, new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 20 }));
  expect(screen.getByRole("button", { name: "Back to current" })).toBeTruthy();
});

it("modifier wheel zooms around the pointer without disabling follow", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollTo");
  const { container } = render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  const page = container.querySelector<HTMLElement>('[data-page="12"]')!;
  const fitted = parseFloat(page.style.width);
  const root = screen.getByLabelText("Textbook pages");
  fireEvent.wheel(root, { ctrlKey: true, deltaY: -20, clientX: 100, clientY: 150 });
  expect(parseFloat(page.style.width)).toBeGreaterThan(fitted);
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  expect(scroll.mock.calls.some(([arg]) => (arg as ScrollToOptions | undefined)?.behavior === "instant")).toBe(true);
  scroll.mockRestore();
});
