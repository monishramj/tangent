import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Home from "./Home";
import { memoryJsonStore, projects, type Project } from "../storage/projects";
import { fakeVideoStore, type VideoBundle } from "../storage/videos";

afterEach(cleanup);

const proj = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "CS 251", emoji: "💻", createdAt: 1, sources: [{ id: "s", name: "b.pdf", pdfPath: "/b.pdf", addedAt: 2 }], notes: [], ...o });
const vid = (o: Partial<VideoBundle> = {}): VideoBundle => ({ id: "v1", title: "Heaps", createdAt: 5, complete: true, source: { pdfPath: "/b.pdf", sectionId: "s1", sectionTitle: "Heaps" }, scenes: [], ...o });

it("creates a project with name and emoji via Enter and persists it", async () => {
  const store = memoryJsonStore();
  render(<Home store={store} videoStore={fakeVideoStore()} onOpenProject={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  const name = screen.getByLabelText("Project name");
  fireEvent.change(name, { target: { value: "STAT 350" } });
  fireEvent.click(screen.getByRole("radio", { name: "Emoji 📊" }));
  fireEvent.submit(name.closest("form")!);
  await screen.findByRole("button", { name: "Open STAT 350" });
  const saved = await projects(store).list();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: "STAT 350", emoji: "📊", sources: [], notes: [] });
});

it("shows counts and opens a project", async () => {
  const onOpen = vi.fn();
  render(<Home store={memoryJsonStore({ projects: [proj()] })} videoStore={fakeVideoStore([vid({ projectId: "p1" }), vid({ id: "v2", projectId: "other" })])} onOpenProject={onOpen} />);
  await screen.findByText("1 source · 1 video");
  fireEvent.click(screen.getByRole("button", { name: "Open CS 251" }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
});

it("renames a project", async () => {
  const store = memoryJsonStore({ projects: [proj()] });
  render(<Home store={store} videoStore={fakeVideoStore()} onOpenProject={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Options for CS 251" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const input = screen.getByLabelText("Project name");
  fireEvent.change(input, { target: { value: "CS 252" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("button", { name: "Open CS 252" });
  await waitFor(async () => expect((await projects(store).list())[0].name).toBe("CS 252"));
});

it("deletes a project only after confirming", async () => {
  const store = memoryJsonStore({ projects: [proj()] });
  render(<Home store={store} videoStore={fakeVideoStore()} onOpenProject={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Options for CS 251" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(await projects(store).list()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Options for CS 251" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Open CS 251" })).toBeNull());
  expect(await projects(store).list()).toEqual([]);
});

it("offers unsorted videos only when no projects exist", async () => {
  const onVideo = vi.fn();
  const vs = fakeVideoStore([vid(), vid({ id: "v2", title: "Owned", projectId: "x" })]);
  render(<Home store={memoryJsonStore()} videoStore={vs} onOpenProject={vi.fn()} onOpenVideo={onVideo} />);
  fireEvent.click(await screen.findByRole("button", { name: /Heaps/ }));
  expect(onVideo).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
  expect(screen.queryByText("Owned")).toBeNull();
  cleanup();
  render(<Home store={memoryJsonStore({ projects: [proj()] })} videoStore={vs} onOpenProject={vi.fn()} onOpenVideo={onVideo} />);
  await screen.findByRole("button", { name: "Open CS 251" });
  expect(screen.queryByText("Unsorted videos")).toBeNull();
});

it("has a demo link", async () => {
  const onDemo = vi.fn();
  render(<Home store={memoryJsonStore()} videoStore={fakeVideoStore()} onOpenProject={vi.fn()} onDemo={onDemo} />);
  fireEvent.click(await screen.findByRole("button", { name: "Heapify demo" }));
  expect(onDemo).toHaveBeenCalled();
});
