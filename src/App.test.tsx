import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong") }));
vi.mock("./Stage", () => ({ default: () => null })); // jsdom has no WebGL
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> })); // jsdom has no IntersectionObserver

HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined); // jsdom: not implemented
HTMLMediaElement.prototype.pause = vi.fn();

// jsdom lacks these browser APIs that AnimatedList uses.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows the sidecar reply and a static title", async () => {
  render(<App />);
  expect((await screen.findByRole("status")).textContent).toBe("sidecar: pong");
  const title = screen.getByRole("heading", { level: 1, name: "Heapify" });
  expect(title.children.length).toBe(0); // plain text, no split/animated spans
});

it("toggles play and pause", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
});

it("opens the sections panel, closes on Esc, and returns focus", () => {
  render(<App />);
  const trigger = screen.getByRole("button", { name: "Sections" });
  trigger.focus();
  fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "Sections" });
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(screen.getAllByRole("option", { current: true }).map((o) => o.textContent)).toEqual([expect.stringContaining("Heapify")]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("hides controls after 3s of inactivity while playing, shows them on mouse move", () => {
  vi.useFakeTimers();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const controls = screen.getByRole("button", { name: "Pause" }).closest("[data-idle]")!;
  expect(controls.getAttribute("data-idle")).toBe("false");
  act(() => vi.advanceTimersByTime(3000));
  expect(controls.getAttribute("data-idle")).toBe("true");
  fireEvent.pointerMove(window);
  expect(controls.getAttribute("data-idle")).toBe("false");
});

it("sections list is keyboard operable and every row has a name", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Sections" }));
  const list = screen.getByRole("listbox", { name: "Sections" });
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(5);
  options.forEach((o) => expect(o.textContent?.trim()).toBeTruthy());
  list.focus();
  fireEvent.keyDown(list, { key: "ArrowDown" }); // cursor starts on the playing row (3), moves to 4
  fireEvent.keyDown(list, { key: "Enter" });
  expect(screen.getByRole("option", { current: true }).textContent).toContain("Building a heap");
});

it("icon-only buttons are labelled and icons are hidden from assistive tech", () => {
  const { container } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Sections" }));
  screen.getAllByRole("button").forEach((b) => {
    if (!b.textContent?.trim()) expect(b.getAttribute("aria-label")).toBeTruthy();
  });
  const svgs = container.ownerDocument.querySelectorAll("svg");
  expect(svgs.length).toBeGreaterThan(5);
  svgs.forEach((svg) => expect(svg.getAttribute("aria-hidden")).toBe("true"));
});
