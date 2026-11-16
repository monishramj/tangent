import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import App from "./App";
import type PlayerScreen from "./player/PlayerScreen";
import { startSession } from "./pipeline/session";
import { withFormulas } from "./library";
import { sectionsText, type IR } from "./home/api";
import { memoryJsonStore, sourceFor } from "./storage/store";
import { fakeVideoStore } from "./storage/videos";

const player = vi.hoisted(() => vi.fn());
vi.mock("./home/Home", () => ({ default: () => null }));
vi.mock("./menu", () => ({ startMenuBridge: () => {}, syncMenu: () => {} }));
vi.mock("./media/giphy", () => ({ giphyKey: async () => null }));
vi.mock("./devlog", () => ({ devlog: vi.fn() }));
vi.mock("./library", () => ({ withFormulas: vi.fn(async (_: string, ir: IR) => ir) }));
vi.mock("./home/api", async orig => ({ ...(await orig<typeof import("./home/api")>()), sectionsText: vi.fn(async (ir: IR) => String(ir.sections[0].markdown)) }));
vi.mock("./pipeline/session", () => ({ startSession: vi.fn(() => (async function* () {
  yield { type: "scene", sceneId: "scene-1", scene: { objects: [], beats: [] }, timeline: { totalSec: 1 }, wavPath: "/a.wav", generationMs: 1 };
})()) }));
vi.mock("./player/PlayerScreen", () => ({ default: (props: React.ComponentProps<typeof PlayerScreen>) => {
  player(props);
  useEffect(() => { void (async () => { for await (const _ of props.stream); })(); }, [props.stream]);
  return null;
} }));

beforeEach(() => { vi.clearAllMocks(); localStorage.setItem("tangent.checksPassed", "1"); });
afterEach(cleanup);
const ir = (text: string): IR => ({ sections: [{ id: "s1", title: "Topic", level: 1, children: [], anchors: [{ page: 1 }], markdown: text,
  passages: [{ id: "p1", markdown: text, boxes: [] }], figures: [{ id: "f1", caption: text, image_path: "/f.png" }], exercises: [{ id: "e1", markdown: text }],
}] });

it.each([false, true])("prepares, records and follows sources through one path (multi=%s)", async multi => {
  const first = ir("Arrays grow."), second = ir("Trees branch.");
  const videoStore = fakeVideoStore();
  render(<App store={memoryJsonStore()} videoStore={videoStore} initial={{ s: "generate", attempt: 0, args: {
    sectionIds: ["s1"], ir: first, meta: { pdfPath: "/a.pdf", title: "Topic", detail: "standard" },
    ...(multi ? { extras: [{ pdfPath: "/b.pdf", sectionIds: ["s1"], ir: second, name: "Trees" }] } : {}),
  } }} />);
  await waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
  const opts = vi.mocked(startSession).mock.calls[0][0];
  const ids = [sourceFor("/a.pdf").id, sourceFor("/b.pdf").id];
  expect(withFormulas).toHaveBeenCalledTimes(multi ? 2 : 1);
  expect(sectionsText).toHaveBeenCalledTimes(multi ? 2 : 1);
  expect(opts.sources).toEqual((multi ? ids : ids.slice(0, 1)).map((id, i) => ({ id, markdown: i ? "Trees branch." : "Arrays grow." })));
  expect(opts.irSection.passages?.map(p => p.id)).toEqual(multi ? ids.map(id => `${id}/p1`) : ["p1"]);
  expect(opts.irSection.figures).toHaveLength(multi ? 2 : 1);
  expect(opts.irSection.exercises).toHaveLength(multi ? 2 : 1);
  await waitFor(() => expect([...videoStore.bundles.values()][0]?.complete).toBe(true));
  const source = [...videoStore.bundles.values()][0].source;
  expect(source).toMatchObject({ pdfPath: "/a.pdf", sectionId: "s1", sectionTitle: "Topic" });
  if (multi) {
    expect(source.also).toEqual([{ id: ids[1], pdfPath: "/b.pdf", sectionId: "s1", sectionTitle: "Trees" }]);
    expect(player.mock.calls[player.mock.calls.length - 1][0].followSources.map((s: { passages: { id: string }[] }) => s.passages[0].id)).toEqual(ids.map(id => `${id}/p1`));
  } else {
    expect(source.also).toBeUndefined();
    expect(player.mock.calls[player.mock.calls.length - 1][0].followSources).toBeUndefined();
  }
});
