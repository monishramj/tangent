import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { memoryJsonStore } from "./storage/store";
import { fakeVideoStore, type VideoBundle } from "./storage/videos";
import { scene, timeline } from "@motion/stage/demo";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/Stage", () => ({ default: () => null }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockImplementation(async cmd => (cmd === "get_secret" ? null : undefined));
  vi.stubGlobal("Audio", class extends EventTarget {
    currentTime = 0; readyState = 4; preload = "";
    play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const vid: VideoBundle = { id: "v1", title: "Heaps", createdAt: 5, complete: true, source: { pdfPath: "/b.pdf", sectionId: "s1", sectionTitle: "Heaps" },
  scenes: [{ sceneId: "s1", scene, timeline, audioFile: "/a.wav", durationSec: timeline.totalSec }] };
const provider = { complete: vi.fn() };

it("home is the barebones start screen: no projects, a drop zone, saved videos and the demo", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([vid])} />);
  expect(screen.getByRole("heading", { name: "Tangent" })).toBeTruthy();
  expect(screen.getByTestId("dropzone")).toBeTruthy();
  expect(screen.queryByText(/project/i)).toBeNull();
  expect(await screen.findByRole("list", { name: "Your videos" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Heapify demo" })).toBeTruthy();
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

it("opening a saved video plays it under its title; Back returns home", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([vid])} />);
  fireEvent.click(await screen.findByText("Heaps"));
  expect(await screen.findByRole("heading", { name: "Heaps" })).toBeTruthy();
  expect(await screen.findByRole("slider")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "Tangent" })).toBeTruthy();
});
