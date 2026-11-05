import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Home from "./Home";
import { listSections } from "./api";
import { loadIr } from "../library";
import { fakeVideoStore, type VideoBundle } from "../storage/videos";

vi.mock("./api", () => ({ listSections: vi.fn() }));
vi.mock("../library", () => ({ loadIr: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
const ingestPdf = vi.mocked(loadIr);
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const ir = { sections: [] };
const flat = [
  { id: "s1", title: "Heaps", level: 1, anchors: [{ page: 3 }, { page: 5 }] },
  { id: "s2", title: "Heapify", level: 2, anchors: [{ page: 4 }] },
];
const pick = (path = "/x/book.pdf") => ({ name: "book.pdf", path }) as unknown as File;

beforeEach(() => {
  localStorage.clear();
  ingestPdf.mockResolvedValue(ir as never);
  vi.mocked(listSections).mockResolvedValue(flat);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows empty recents and the demo entry, which opens the demo player", () => {
  const onDemo = vi.fn();
  render(<Home onDemo={onDemo} />);
  expect(screen.getByText(/no recent videos/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /heapify demo/i }));
  expect(onDemo).toHaveBeenCalled();
});

it("ingests a chosen PDF, shows loading, then nested sections with pages; picking calls onStart", async () => {
  let resolve!: (v: never) => void;
  ingestPdf.mockReturnValue(new Promise((r) => (resolve = r as never)));
  const onStart = vi.fn();
  const { container } = render(<Home onStart={onStart} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  expect((await screen.findByRole("status")).textContent).toMatch(/reading/i);
  expect(ingestPdf).toHaveBeenCalledWith("/x/book.pdf", expect.any(Function), expect.anything());
  resolve(ir as never);
  await screen.findByRole("listbox", { name: "Sections" });
  const opts = screen.getAllByRole("option");
  expect(opts[0].textContent).toContain("Heaps");
  expect(opts[0].textContent).toContain("pp. 3-5");
  expect(opts[1].textContent).toContain("p. 4");
  fireEvent.click(opts[1]);
  expect(onStart).toHaveBeenCalledWith("s2", ir, { pdfPath: "/x/book.pdf", title: "Heapify" });
});

it("records a recent video when a section starts", async () => {
  const { container } = render(<Home onStart={vi.fn()} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  fireEvent.click((await screen.findAllByRole("option"))[0]);
  expect(JSON.parse(localStorage.getItem("tangent.recent")!)[0]).toMatchObject({ sectionId: "s1", title: "Heaps", path: "/x/book.pdf" });
});

it("lists recents from localStorage", () => {
  localStorage.setItem("tangent.recent", JSON.stringify([{ path: "/a.pdf", sectionId: "s1", title: "Heaps" }]));
  render(<Home />);
  const list = screen.getByRole("list", { name: /recent videos/i });
  expect(within(list).getByText("Heaps")).toBeTruthy();
});

it("shows an error when ingest fails and allows retry", async () => {
  ingestPdf.mockRejectedValueOnce("not a pdf");
  const { container } = render(<Home />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  expect((await screen.findByRole("alert")).textContent).toContain("not a pdf");
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("accepts a dropped PDF and rejects non-PDF", async () => {
  render(<Home />);
  const zone = screen.getByTestId("dropzone");
  fireEvent.drop(zone, { dataTransfer: { files: [{ name: "a.txt" }] } });
  expect((await screen.findByRole("alert")).textContent).toMatch(/pdf/i);
  expect(ingestPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  fireEvent.drop(zone, { dataTransfer: { files: [pick("/d/b.pdf")] } });
  await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/d/b.pdf", expect.any(Function), expect.anything()));
});

// Tauri path: the webview has no File.path, so the dialog plugin and drag-drop event supply absolute paths.
const dlg = vi.hoisted(() => ({ open: vi.fn(), handler: undefined as undefined | ((e: { payload: unknown }) => void), unlisten: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dlg.open }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async (h: typeof dlg.handler) => { dlg.handler = h; return dlg.unlisten; } }),
}));

it("in Tauri, Choose PDF uses the dialog plugin with a PDF filter", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  try {
    dlg.open.mockResolvedValue("/abs/book.pdf");
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /choose pdf/i }));
    await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/abs/book.pdf", expect.any(Function), expect.anything()));
    expect(dlg.open).toHaveBeenCalledWith({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});

it("in Tauri, a cancelled dialog does nothing", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  try {
    dlg.open.mockResolvedValue(null);
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /choose pdf/i }));
    await waitFor(() => expect(dlg.open).toHaveBeenCalled());
    expect(ingestPdf).not.toHaveBeenCalled();
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});

it("in Tauri, dropped files ingest the first .pdf path", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  try {
    render(<Home />);
    await waitFor(() => expect(dlg.handler).toBeDefined());
    dlg.handler!({ payload: { type: "drop", paths: ["/d/notes.txt", "/d/c.PDF"] } });
    await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/d/c.PDF", expect.any(Function), expect.anything()));
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});

it("in Tauri, dropping only non-PDFs shows an error", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  try {
    render(<Home />);
    await waitFor(() => expect(dlg.handler).toBeDefined());
    dlg.handler!({ payload: { type: "drop", paths: ["/d/a.txt"] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/pdf/i);
    expect(ingestPdf).not.toHaveBeenCalled();
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});

const vid = (over: Partial<VideoBundle> = {}): VideoBundle => ({
  id: "v1", title: "Heaps", createdAt: Date.UTC(2026, 0, 2, 12), complete: false,
  source: { pdfPath: "/x/book.pdf", sectionId: "s1", sectionTitle: "Heaps" },
  scenes: [{ sceneId: "scene-1", scene: {} as never, timeline: {} as never, audioFile: "/a.wav", durationSec: 75 }], ...over,
});

it("lists saved videos with duration and partial/complete badge; clicking opens one", async () => {
  const onOpenVideo = vi.fn();
  render(<Home store={fakeVideoStore([vid(), vid({ id: "v2", title: "Done", complete: true, createdAt: 1 })])} onOpenVideo={onOpenVideo} />);
  const items = await within(await screen.findByRole("list", { name: "Your videos" })).findAllByRole("listitem");
  expect(items[0].textContent).toMatch(/Heaps.*1:15.*Partial/);
  expect(items[1].textContent).toMatch(/Done.*Complete/);
  fireEvent.click(within(items[0]).getByText("Heaps"));
  expect(onOpenVideo.mock.calls[0][0].id).toBe("v1");
});

it("delete asks for confirmation, can be cancelled, then removes from the store", async () => {
  const store = fakeVideoStore([vid()]);
  render(<Home store={store} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete Heaps" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(store.bundles.size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete Heaps" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(store.bundles.size).toBe(0));
  expect(await screen.findByText(/no saved videos/i)).toBeTruthy();
});

it("starting a section that already has a saved video offers Open saved vs Regenerate", async () => {
  const store = fakeVideoStore([vid()]);
  const onStart = vi.fn(), onOpenVideo = vi.fn();
  const { container } = render(<Home store={store} onStart={onStart} onOpenVideo={onOpenVideo} />);
  await screen.findByRole("list", { name: "Your videos" });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  fireEvent.click((await screen.findAllByRole("option"))[0]);
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Open saved" }));
  expect(onOpenVideo.mock.calls[0][0].id).toBe("v1");
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click((await screen.findAllByRole("option"))[0]);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Regenerate" }));
  expect(onStart).toHaveBeenCalledWith("s1", ir, { pdfPath: "/x/book.pdf", title: "Heaps" });
});

it("shows ingest progress while reading", async () => {
  ingestPdf.mockImplementation((_p, onProgress) => { onProgress?.({ fraction: .4, label: "Reading 12 pages · ~8 s" }); return new Promise(() => {}); });
  const { container } = render(<Home />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  expect((await screen.findByRole("status")).textContent).toContain("Reading 12 pages · ~8 s");
});

it("the reaction gifs popover saves a GIPHY key to the Keychain", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  render(<Home />);
  fireEvent.click(screen.getByRole("button", { name: /reaction gifs/i }));
  const dlg = screen.getByRole("dialog", { name: "Reaction gifs" });
  expect(await within(dlg).findByText("No key saved.")).toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText("GIPHY API key"), { target: { value: " abc " } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Save" })); });
  expect(invoke).toHaveBeenCalledWith("set_secret", { name: "giphy", value: "abc" });
  expect(within(dlg).getByText("A key is saved.")).toBeTruthy();
});
