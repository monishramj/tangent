import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadIr } from "./library";
import App from "./App";
import { memoryJsonStore, sourceFor } from "./storage/store";
import { fakeVideoStore, type VideoBundle } from "./storage/videos";
import { scene, timeline } from "@motion/stage/demo";

vi.mock("./library", async orig => ({ ...(await orig<typeof import("./library")>()), loadIr: vi.fn().mockResolvedValue({ sections: [] }) }));
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

it("home opens the sources-first library with saved videos and no demo", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([vid])} />);
  expect(screen.getByRole("heading", { name: "library" })).toBeTruthy();
  expect(screen.getByTestId("dropzone")).toBeTruthy();
  expect(screen.queryByText(/project/i)).toBeNull();
  expect(await screen.findByRole("list", { name: "Recent videos" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /demo/i })).toBeNull();
});

it("opening a saved video plays it under its title; Back returns home", async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([vid])} />);
  fireEvent.click(await screen.findByText("Heaps"));
  expect(await screen.findByRole("heading", { name: "Heaps" })).toBeTruthy();
  expect(await screen.findByRole("slider")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "library" })).toBeTruthy();
});

it("Back from a saved video restores the source and its folder", async () => {
  const source = { ...sourceFor('/b.pdf'), folderId: 'f1' };
  const store = memoryJsonStore({ library: { folders: [{ id: 'f1', name: 'Course', emoji: '📚', openedAt: 1 }], sources: [source] }, [`ir-${source.id}`]: { sections: [] } });
  vi.mocked(invoke).mockImplementation(async cmd => cmd === 'sidecar_call' ? [] : null);
  render(<App provider={provider} store={store} videoStore={fakeVideoStore([vid])} initial={{ s: 'source', sourceId: source.id, folderId: 'f1' }} />);
  fireEvent.click(await screen.findByText('Heaps'));
  await screen.findByRole('slider');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('heading', { name: 'b.pdf' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Course' }));
  expect(await screen.findByRole('heading', { name: /Course/ })).toBeTruthy();
});

it('routes the Home gear to Settings and its back button to Home', async () => {
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([])} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  expect(screen.queryByTestId('dropzone')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  expect(screen.getByRole('heading', { name: 'library' })).toBeTruthy();
});


it('continues the upload queue during saved-video playback and keeps its status on return', async () => {
  let finish!: (value: { sections: [] }) => void;
  vi.mocked(loadIr).mockClear().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<App provider={provider} store={memoryJsonStore()} videoStore={fakeVideoStore([vid])} />);
  await screen.findByRole('list', { name: 'Recent videos' });
  fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [{ name: 'a.pdf', path: '/a.pdf' }, { name: 'c.pdf', path: '/c.pdf' }] } });
  await screen.findByText('c.pdf');
  fireEvent.click(screen.getByText('Heaps'));
  await screen.findByRole('slider');
  await act(async () => { finish({ sections: [] }); });
  await waitFor(() => expect(vi.mocked(loadIr).mock.calls.map(call => call[0])).toEqual(['/a.pdf', '/c.pdf']));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'library' });
  expect(screen.getAllByText(/Done/)).toHaveLength(2);
});
