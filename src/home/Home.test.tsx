import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Home from "./Home";
import { ingestPdf, listSections } from "./api";

vi.mock("./api", () => ({ ingestPdf: vi.fn(), listSections: vi.fn() }));
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
  vi.mocked(ingestPdf).mockResolvedValue(ir as never);
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
  vi.mocked(ingestPdf).mockReturnValue(new Promise((r) => (resolve = r as never)));
  const onStart = vi.fn();
  const { container } = render(<Home onStart={onStart} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pick()] } });
  expect((await screen.findByRole("status")).textContent).toMatch(/reading/i);
  expect(ingestPdf).toHaveBeenCalledWith("/x/book.pdf");
  resolve(ir as never);
  await screen.findByRole("listbox", { name: "Sections" });
  const opts = screen.getAllByRole("option");
  expect(opts[0].textContent).toContain("Heaps");
  expect(opts[0].textContent).toContain("pp. 3-5");
  expect(opts[1].textContent).toContain("p. 4");
  fireEvent.click(opts[1]);
  expect(onStart).toHaveBeenCalledWith("s2", ir);
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
  vi.mocked(ingestPdf).mockRejectedValueOnce("not a pdf");
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
  await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/d/b.pdf"));
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
    await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/abs/book.pdf"));
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
    await waitFor(() => expect(ingestPdf).toHaveBeenCalledWith("/d/c.PDF"));
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
