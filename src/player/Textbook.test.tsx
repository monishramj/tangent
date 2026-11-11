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
  render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  await screen.findByAltText("Page 12");
  const fitted = parseFloat(screen.getByLabelText("Textbook pages").style.getPropertyValue("--page-w"));
  expect(fitted).toBeCloseTo(360 * 0.94 / 0.8);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(parseFloat(screen.getByLabelText("Textbook pages").style.getPropertyValue("--page-w"))).toBeCloseTo(fitted * 1.25);
  expect(screen.getByRole("button", { name: "Fit width" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(parseFloat(screen.getByLabelText("Textbook pages").style.getPropertyValue("--page-w"))).toBeCloseTo(fitted);
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
  expect(parseFloat(screen.getByLabelText("Textbook pages").style.getPropertyValue("--page-w"))).toBeCloseTo(fitted);
  expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
  expect(screen.getByRole("button", { name: "Fit width" }).getAttribute("aria-pressed")).toBe("true");
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

it("batches modifier wheel previews per frame and commits width only after settling", async () => {
  vi.useFakeTimers();
  try {
    const renderer = vi.fn<RenderPage>(renderPage);
    render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderer} />);
    await act(async () => {});
    act(() => { vi.advanceTimersByTime(250); });
    const root = screen.getByLabelText("Textbook pages");
    const inner = root.querySelector<HTMLElement>(".flow-root")!;
    const initialCalls = renderer.mock.calls.length;
    const fitted = root.style.getPropertyValue("--page-w");
    const writes = vi.spyOn(inner.style, "transform", "set");
    for (let i = 0; i < 4; i++) fireEvent.wheel(root, { ctrlKey: true, deltaY: -20, clientX: 100, clientY: 150 });
    expect(writes).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue("--page-w")).toBe(fitted);
    act(() => { vi.advanceTimersByTime(16); });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(Number(inner.style.transform.match(/scale\(([^)]+)\)/)?.[1])).toBeCloseTo(Math.exp(0.8));
    expect(inner.style.willChange).toBe("transform");
    act(() => { vi.advanceTimersByTime(133); });
    expect(root.style.getPropertyValue("--page-w")).toBe(fitted);
    act(() => { vi.advanceTimersByTime(1); });
    expect(parseFloat(root.style.getPropertyValue("--page-w"))).toBeCloseTo(parseFloat(fitted) * Math.exp(0.8));
    expect(renderer).toHaveBeenCalledTimes(initialCalls);
    await act(async () => { vi.advanceTimersByTime(249); });
    expect(renderer).toHaveBeenCalledTimes(initialCalls);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(renderer).toHaveBeenCalledTimes(initialCalls + 1);
    expect(inner.style.transform).toBe("");
    expect(inner.style.willChange).toBe("");
    expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
    expect(screen.getAllByTestId("passage-highlight")).toHaveLength(1);
  } finally { cleanup(); vi.useRealTimers(); }
});

it("WebKit gestures prevent page zoom, take over wheel without doubling, and clamp", async () => {
  vi.useFakeTimers();
  try {
    render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
    await act(async () => {});
    const root = screen.getByLabelText("Textbook pages");
    const fitted = parseFloat(root.style.getPropertyValue("--page-w"));
    const gesture = (name: string, scale = 1) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 100, clientY: 150 });
      fireEvent(root, event);
      expect(event.defaultPrevented).toBe(true);
    };
    fireEvent.wheel(root, { ctrlKey: true, deltaY: -20 });
    gesture("gesturestart");
    gesture("gesturechange", 1.5);
    fireEvent.wheel(root, { ctrlKey: true, deltaY: -20 });
    gesture("gestureend", 1.5);
    fireEvent.wheel(root, { ctrlKey: true, deltaY: -20 });
    act(() => { vi.advanceTimersByTime(150); });
    expect(parseFloat(root.style.getPropertyValue("--page-w"))).toBeCloseTo(fitted * 1.5);
    gesture("gesturestart"); gesture("gesturechange", 100); gesture("gestureend");
    act(() => { vi.advanceTimersByTime(150); });
    expect(parseFloat(root.style.getPropertyValue("--page-w"))).toBe(360 * 4);
    gesture("gesturestart"); gesture("gesturechange", 0.001); gesture("gestureend");
    act(() => { vi.advanceTimersByTime(150); });
    expect(parseFloat(root.style.getPropertyValue("--page-w"))).toBe(360 * 0.5);
  } finally { cleanup(); vi.useRealTimers(); }
});

it("shows a loading circle until the first image arrives and preserves the error message", async () => {
  const pending = vi.fn<RenderPage>(() => new Promise(() => {}));
  const view = render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={pending} />);
  expect(screen.getByRole("status", { name: "Loading page 12" })).toBeTruthy();
  view.rerender(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderPage} />);
  await screen.findByAltText("Page 12");
  expect(screen.queryByRole("status", { name: "Loading page 12" })).toBeNull();
  cleanup();
  render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={async () => { throw new Error("offline"); }} />);
  await screen.findByText("Couldn't load page 12.");
  expect(screen.queryByRole("status", { name: "Loading page 12" })).toBeNull();
});

it("debounces sharper renders, keeps the old image visible, and never rerenders at a lower bucket", async () => {
  vi.useFakeTimers();
  try {
    const renderer = vi.fn<RenderPage>(renderPage);
    render(<Textbook source={source} scenes={mapped} time={0.5} renderPage={renderer} />);
    await act(async () => {});
    const initialCalls = renderer.mock.calls.length;
    const image = screen.getByAltText("Page 12");
    const scroll = vi.spyOn(Element.prototype, "scrollTo");
    scroll.mockClear();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(renderer).toHaveBeenCalledTimes(initialCalls);
    expect(screen.getByAltText("Page 12")).toBe(image);
    expect(scroll.mock.calls.every(([arg]) => (arg as ScrollToOptions)?.behavior === "instant")).toBe(true);
    await act(async () => { vi.advanceTimersByTime(249); });
    expect(renderer).toHaveBeenCalledTimes(initialCalls);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(renderer).toHaveBeenCalledTimes(initialCalls + 1);
    const sharperCalls = renderer.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(renderer).toHaveBeenCalledTimes(sharperCalls);
    scroll.mockRestore();
  } finally { vi.useRealTimers(); }
});
