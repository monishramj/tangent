import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/path", () => ({ tempDir: async () => "/tmp", join: async (...parts: string[]) => parts.join("/") }));
const stage = vi.fn();
vi.mock("./Stage", () => ({ default: (props: unknown) => { stage(props); return null; } }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const ir = { sections: [] };
const markdown = "# Arrays\nArrays hold a sequence of values.";
const say = "Arrays grow.";
const script = JSON.stringify([{ say, visualIntent: "Show an array" }]);
const scene = JSON.stringify({ scene: "arrays", objects: [{ id: "a", type: "Array", init: [1] }], beats: [{ say, actions: [{ at: "Arrays", do: "create", target: "a" }] }] });
const complete = vi.fn();
const provider = { complete };
const play = vi.fn().mockResolvedValue(undefined);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
let tts: ReturnType<typeof deferred<void>>;
beforeEach(() => {
  localStorage.clear();
  stage.mockClear(); play.mockClear(); complete.mockReset();
  tts = deferred<void>();
  vi.stubGlobal("Audio", class extends EventTarget {
    currentTime = 0; readyState = 4; preload = "";
    play = play; pause = vi.fn();
  });
  vi.mocked(invoke).mockReset().mockImplementation(async (_cmd, args) => {
    const a = args as { method: string; params: { out_path: string } };
    if (a?.method === "ingest_pdf") return ir;
    if (a?.method === "list_sections") return [{ id: "s1", title: "Arrays", level: 1, anchors: [] }];
    if (a?.method === "section_text") return markdown;
    if (a?.method === "tts_align") {
      await tts.promise;
      return { wav_path: a.params.out_path, sec: 2, words: [{ word: "Arrays", start: 0, end: 1 }, { word: "grow.", start: 1, end: 2 }] };
    }
    return "pong";
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function pick() {
  const view = render(<App initial="home" provider={provider} />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [{ name: "book.pdf", path: "/book.pdf" }] } });
  fireEvent.click(await screen.findByRole("option", { name: "Arrays" }));
  return view;
}

it("runs a picked section, reports real generation phases, autoplays and grounds the tutor in markdown", async () => {
  const writing = deferred<string>();
  const building = deferred<string>();
  complete.mockReturnValueOnce(writing.promise).mockReturnValueOnce(building.promise)
    .mockResolvedValue(JSON.stringify({ answer: "A sequence.", annotations: [] }));
  await pick();
  expect((await screen.findByRole("status", { name: "Generation progress" })).textContent).toMatch(/writing script/i);
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "section_text", params: { ir, id: "s1" } });
  await act(async () => writing.resolve(script));
  expect(screen.getByRole("status", { name: "Generation progress" }).textContent).toMatch(/generating narration/i);
  expect(screen.getByRole("status", { name: "Buffering" })).toBeTruthy();
  await act(async () => tts.resolve());
  expect(screen.getByRole("status", { name: "Generation progress" }).textContent).toMatch(/building scenes/i);
  await act(async () => building.resolve(scene));
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
  expect(screen.queryByRole("status", { name: "Generation progress" })).toBeNull();
  expect(screen.queryByRole("status", { name: "Buffering" })).toBeNull();
  expect(play).toHaveBeenCalled();
  expect(stage).toHaveBeenLastCalledWith(expect.objectContaining({ scene: expect.objectContaining({ scene: "scene-1" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.change(screen.getByLabelText(/ask about this moment/i), { target: { value: "What is an array?" } });
  fireEvent.submit(screen.getByLabelText(/ask about this moment/i).closest("form")!);
  await screen.findByText("A sequence.");
  expect(complete.mock.calls[complete.mock.calls.length - 1]?.[0]).toContain(`Section:\n${markdown}`);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Tangent" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Arrays.*book.pdf/i }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([, args]) => (args as { method?: string })?.method === "section_text")).toHaveLength(2));
});

it("surfaces section loading errors and retries the same section", async () => {
  const base = vi.mocked(invoke).getMockImplementation()!;
  let failed = false;
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if ((args as { method?: string })?.method === "section_text" && !failed) { failed = true; throw new Error("Section unavailable"); }
    return base(cmd, args);
  });
  complete.mockResolvedValueOnce(script).mockResolvedValue(scene);
  await pick();
  expect((await screen.findByRole("alert")).textContent).toContain("Section unavailable");
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  await screen.findByRole("status", { name: "Generation progress" });
  await act(async () => tts.resolve());
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
});

it("retries failed generation and cancels pending work on Back", async () => {
  complete.mockRejectedValue(new Error("Provider offline"));
  await pick();
  expect((await screen.findByRole("alert")).textContent).toContain("Provider offline");
  const pending = deferred<string>();
  complete.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  await screen.findByRole("status", { name: "Generation progress" });
  await waitFor(() => expect(complete.mock.calls[complete.mock.calls.length - 1]?.[1]?.signal).toBeTruthy());
  const signal = complete.mock.calls[complete.mock.calls.length - 1]![1].signal as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(script));
  expect(screen.getByRole("heading", { name: "Tangent" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("surfaces scene build errors and retries generation from the section", async () => {
  complete.mockResolvedValueOnce(script).mockResolvedValue("{}");
  tts.resolve();
  await pick();
  expect((await screen.findByRole("alert")).textContent).toMatch(/Scene scene-1: Invalid scene DSL/);
  complete.mockReset().mockResolvedValueOnce(script).mockResolvedValue(scene);
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("ignores a late section response after returning Home", async () => {
  const reading = deferred<string>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) =>
    (args as { method?: string })?.method === "section_text" ? reading.promise as never : original(command, args));
  await pick();
  await screen.findByText("Reading section…");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await act(async () => reading.resolve(markdown));
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Tangent" })).toBeTruthy();
});

it("starts only one pipeline under the app's StrictMode effects", async () => {
  complete.mockResolvedValueOnce(script).mockResolvedValue(scene);
  tts.resolve();
  const view = render(<StrictMode><App initial="home" provider={provider} /></StrictMode>);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [{ name: "book.pdf", path: "/book.pdf" }] } });
  fireEvent.click(await screen.findByRole("option", { name: "Arrays" }));
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
  expect(complete).toHaveBeenCalledTimes(2);
  expect(play).toHaveBeenCalled();
});

it("saves the streamed video, lists it on Home, and replays it with no LLM or TTS calls", async () => {
  complete.mockResolvedValueOnce(script).mockResolvedValue(scene);
  tts.resolve();
  const saved: Record<string, any>[] = [];
  const base = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === "save_video_bundle") { const b = structuredClone((args as any).bundle); b.scenes.forEach((s: any) => (s.audioFile = `/data/videos/${b.id}/${s.sceneId}.wav`)); saved.push(b); return b; }
    if (cmd === "list_video_bundles") return saved.slice(-1);
    return base(cmd, args);
  });
  await pick();
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
  await waitFor(() => expect(saved[saved.length - 1]?.complete).toBe(true));
  expect(saved[0]).toMatchObject({ title: "Arrays", complete: false, source: { pdfPath: "/book.pdf", sectionId: "s1", sectionTitle: "Arrays" } });
  expect(saved[saved.length - 1].scenes[0]).toMatchObject({ sceneId: "scene-1", durationSec: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  const llmCalls = complete.mock.calls.length;
  const ttsCalls = () => vi.mocked(invoke).mock.calls.filter(([, a]) => (a as any)?.method === "tts_align").length;
  const ttsBefore = ttsCalls();
  const list = await screen.findByRole("list", { name: "Your videos" });
  fireEvent.click(within(list).getByText("Arrays"));
  await waitFor(() => expect(screen.getByRole("slider").getAttribute("max")).toBe("2"));
  expect(stage).toHaveBeenLastCalledWith(expect.objectContaining({ scene: expect.objectContaining({ scene: "scene-1" }) }));
  expect(complete.mock.calls.length).toBe(llmCalls);
  expect(ttsCalls()).toBe(ttsBefore);
});
