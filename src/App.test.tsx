import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong") }));
vi.mock("./Stage", () => ({ default: () => null })); // jsdom has no WebGL
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> })); // jsdom has no IntersectionObserver

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
  expect(screen.getAllByRole("button", { current: true })).toHaveLength(1);
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
