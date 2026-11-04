import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { memoryJsonStore, type Project } from "./storage/projects";
import { fakeVideoStore, type VideoBundle } from "./storage/videos";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/Stage", () => ({ default: () => null }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async cmd => (cmd === "get_secret" ? null : undefined));
  vi.stubGlobal("Audio", class extends EventTarget {
    currentTime = 0; readyState = 4; preload = "";
    play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const proj: Project = { id: "p1", name: "CS 251", emoji: "💻", createdAt: 1, sources: [], notes: [] };
const vid: VideoBundle = { id: "v1", title: "Heaps", createdAt: 5, complete: true, projectId: "p1", source: { pdfPath: "/b.pdf", sectionId: "s1", sectionTitle: "Heaps" }, scenes: [] };
const provider = { complete: vi.fn() };

it("home lists stored projects and opens the project page", async () => {
  render(<App provider={provider} store={memoryJsonStore({ projects: [proj] })} videoStore={fakeVideoStore([vid])} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open CS 251" }));
  expect(await screen.findByRole("button", { name: "Rename project" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rename project" }).textContent).toBe("CS 251");
  expect(screen.getByRole("region", { name: "Sources" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
  expect(await screen.findByRole("button", { name: "Open CS 251" })).toBeTruthy();
});

it("Settings opens from home, reports no saved key, and goes back", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(await screen.findByText("No key saved.")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("get_secret", { name: "giphy" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
});

it("Settings reports a saved key", async () => {
  vi.mocked(invoke).mockImplementation(async cmd => (cmd === "get_secret" ? "abc" : undefined));
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  expect(await screen.findByText("A key is saved.")).toBeTruthy();
});

it("the demo link opens the player titled Heapify, and Back returns home", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Heapify demo" }));
  expect(await screen.findByRole("heading", { name: "Heapify" })).toBeTruthy();
  expect(screen.getByTestId("video").className).toContain("aspect-video");
  expect(await screen.findByRole("button", { name: /^(Play|Pause)$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Heapify demo" })).toBeTruthy();
});

it("opening a saved video from a project plays it under its title", async () => {
  const withScene: VideoBundle = { ...vid, scenes: [] };
  const vs = fakeVideoStore([withScene]);
  render(<App provider={provider} store={memoryJsonStore({ projects: [proj] })} videoStore={vs} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open CS 251" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open Heaps" }));
  expect(await screen.findByRole("heading", { name: "Heaps" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Rename project" })).toBeTruthy();
});
