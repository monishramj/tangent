import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProjectPage, { type ProjectPageProps } from "./ProjectPage";
import { memoryJsonStore, projects, type Project } from "../storage/projects";
import { fakeVideoStore, type VideoBundle } from "../storage/videos";

afterEach(cleanup);

const secs = [
  { id: "s1", title: "Heaps", level: 1, anchors: [{ page: 3 }, { page: 5 }] },
  { id: "s2", title: "Heapify", level: 2, anchors: [{ page: 4 }] },
];
const src = { id: "src1", name: "book.pdf", pdfPath: "/x/book.pdf", addedAt: 2 };
const proj = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "CS 251", emoji: "💻", createdAt: 1, sources: [src], notes: [], ...o });
const vid = (o: Partial<VideoBundle> = {}): VideoBundle => ({
  id: "v1", title: "Heapify", createdAt: 5, complete: false, projectId: "p1",
  source: { pdfPath: "/x/book.pdf", sectionId: "s2", sectionTitle: "Heapify" },
  scenes: [{ sceneId: "a", scene: {} as never, timeline: {} as never, audioFile: "a.wav", durationSec: 125 }], ...o,
});

function setup(p: Project, videos: VideoBundle[] = [], o: Partial<ProjectPageProps> = {}) {
  const store = memoryJsonStore({ projects: [p] });
  const props = { onGenerate: vi.fn(), onOpenVideo: vi.fn(), onBack: vi.fn(), pickPdf: vi.fn(async () => null), loadSections: vi.fn(async () => secs), ...o };
  render(<ProjectPage project={p} store={store} videoStore={fakeVideoStore(videos)} {...props} />);
  return { store, ...props };
}
const expand = async () => { fireEvent.click(screen.getByRole("button", { name: "Sections of book.pdf" })); await screen.findByText("Heaps"); };

it("adds a picked PDF as a source and saves it", async () => {
  const { store, pickPdf } = setup(proj({ sources: [] }), [], { pickPdf: vi.fn(async () => "/x/new.pdf") });
  fireEvent.click(screen.getByRole("button", { name: "Add PDF" }));
  await screen.findByText("new.pdf");
  expect(pickPdf).not.toBe(undefined);
  const saved = (await projects(store).list())[0];
  expect(saved.sources[0]).toMatchObject({ name: "new.pdf", pdfPath: "/x/new.pdf" });
  expect(saved.sources[0].id).toMatch(/^src/);
});

it("adds dropped PDFs and rejects other files", async () => {
  setup(proj({ sources: [] }));
  const region = screen.getByRole("region", { name: "Sources" });
  fireEvent.drop(region, { dataTransfer: { files: [new File([""], "a.txt")] } });
  expect((await screen.findByRole("alert")).textContent).toMatch(/isn't a PDF/);
  fireEvent.drop(region, { dataTransfer: { files: [new File([""], "dropped.pdf")] } });
  await screen.findByText("dropped.pdf");
});

it("loads sections lazily with progress, then shows indented rows with pages", async () => {
  let report!: (p: { fraction: number; label: string }) => void;
  let done!: (s: typeof secs) => void;
  const loadSections = vi.fn((_s, cb) => { report = cb; return new Promise<typeof secs>(r => (done = r)); });
  setup(proj(), [], { loadSections });
  expect(loadSections).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sections of book.pdf" }));
  expect(await screen.findByRole("progressbar")).toBeTruthy();
  act(() => report({ fraction: 0.4, label: "Parsing" }));
  expect(screen.getByRole("progressbar", { name: "Parsing" }).getAttribute("aria-valuenow")).toBe("40");
  await act(async () => done(secs));
  expect(screen.getByText("pp. 3-5")).toBeTruthy();
  expect(screen.getByText("p. 4")).toBeTruthy();
  expect(loadSections).toHaveBeenCalledWith(expect.objectContaining({ id: "src1" }), expect.any(Function));
});

it("Generate and Watch call back with the right args", async () => {
  const p = proj();
  const { onGenerate, onOpenVideo } = setup(p, [vid()]);
  await expand();
  fireEvent.click(screen.getByRole("button", { name: "Generate Heaps" }));
  expect(onGenerate).toHaveBeenCalledWith({ project: p, source: src, sectionId: "s1", title: "Heaps" });
  expect(screen.queryByRole("button", { name: "Generate Heapify" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Watch Heapify" }));
  expect(onOpenVideo).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
});

it("lists only this project's saved videos with duration and badge; deletes after confirm", async () => {
  const vs = fakeVideoStore([vid(), vid({ id: "v2", title: "Elsewhere", projectId: "other" })]);
  const store = memoryJsonStore({ projects: [proj()] });
  render(<ProjectPage project={proj()} store={store} videoStore={vs} pickPdf={async () => null} loadSections={async () => secs} onGenerate={vi.fn()} onOpenVideo={vi.fn()} onBack={vi.fn()} />);
  const list = await screen.findByRole("list", { name: "Saved videos" });
  expect(within(list).getByText(/2:05 .* Partial/)).toBeTruthy();
  expect(screen.queryByText("Elsewhere")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Delete Heapify" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(vs.bundles.has("v1")).toBe(false));
});

it("adds a note with Ctrl+Enter, persists it, edits and deletes it", async () => {
  const { store } = setup(proj());
  const box = screen.getByLabelText("New note");
  fireEvent.change(box, { target: { value: "remember siftDown" } });
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  await screen.findByText("remember siftDown");
  expect((await projects(store).list())[0].notes[0].text).toBe("remember siftDown");
  fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
  fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "edited" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("edited");
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(screen.queryByText("edited")).toBeNull());
  expect((await projects(store).list())[0].notes).toEqual([]);
});

it("note chip jumps to the matching video, newest note first", async () => {
  const notes = [
    { id: "n1", text: "old", createdAt: 1 },
    { id: "n2", text: "new", createdAt: 9, from: { videoId: "v1", videoTitle: "Heapify", t: 65 } },
  ];
  const { onOpenVideo } = setup(proj({ notes }), [vid()]);
  const items = await screen.findAllByRole("listitem");
  expect(items.findIndex(i => i.textContent?.includes("new"))).toBeLessThan(items.findIndex(i => i.textContent?.includes("old")));
  fireEvent.click(await screen.findByRole("button", { name: "▶ Heapify @ 1:05" }));
  expect(onOpenVideo).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
});

it("practice tab shows empty state and items", () => {
  const { unmount } = render(<ProjectPage project={proj()} store={memoryJsonStore()} videoStore={fakeVideoStore()} pickPdf={async () => null} loadSections={async () => secs} onGenerate={vi.fn()} onOpenVideo={vi.fn()} onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
  expect(screen.getByText("No practice yet")).toBeTruthy();
  unmount();
  render(<ProjectPage project={proj()} store={memoryJsonStore()} videoStore={fakeVideoStore()} pickPdf={async () => null} loadSections={async () => secs} onGenerate={vi.fn()} onOpenVideo={vi.fn()} onBack={vi.fn()} practice={[{ videoTitle: "Heapify", prompt: "Sift 3 down", correct: true }]} />);
  fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
  expect(screen.getByText("Sift 3 down")).toBeTruthy();
});

it("renames the project from the header, removes a source after confirm, and goes back", async () => {
  const { store, onBack } = setup(proj());
  fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
  const input = screen.getByLabelText("Project name");
  fireEvent.change(input, { target: { value: "CS 252" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("button", { name: "Rename project" });
  await waitFor(async () => expect((await projects(store).list())[0].name).toBe("CS 252"));
  fireEvent.click(screen.getByRole("button", { name: "Remove book.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
  await waitFor(async () => expect((await projects(store).list())[0].sources).toEqual([]));
  fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
  expect(onBack).toHaveBeenCalled();
});
