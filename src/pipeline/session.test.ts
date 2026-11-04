// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { startSession } from "./session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/path", () => ({ tempDir: async () => "/tmp", join: async (...parts: string[]) => parts.join("/") }));
const say = "Arrays grow.";
const script = JSON.stringify([{ say, visualIntent: "Show an array" }]);
const scene = JSON.stringify({ scene: "s", objects: [{ id: "a", type: "Array", init: [1] }],
  beats: [{ say, actions: [{ at: "Arrays", do: "create", target: "a" }] }] });
const audio = { wavPath: "/fake.wav", sec: 2, words: [{ word: "Arrays", start: 0, end: 1 }, { word: "grow.", start: 1, end: 2 }] };
beforeEach(() => { vi.mocked(invoke).mockReset(); });

it("runs a section with real defaults through fake IPC and returns playable scenes and status", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as { prompt: string; params: { out_path: string } };
    if (command === "llm_complete") return a.prompt.startsWith("Rewrite") ? script : scene;
    return { wav_path: a.params.out_path, sec: audio.sec, words: audio.words };
  });
  const session = startSession({ irSection: { markdown: "Source arrays." } });
  expect(session.status()).toBe("idle");
  const events = [];
  for await (const event of session) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "scene", sceneId: "scene-1", wavPath: expect.stringMatching(/^asset:\/\/\/tmp\/tangent-.*\.wav$/) });
  expect(session.status()).toBe("done");
  expect(invoke).toHaveBeenCalledWith("llm_complete", expect.objectContaining({ provider: "claude", prompt: expect.stringContaining("Source arrays.") }));
});

it("accepts provider and TTS overrides without IPC", async () => {
  const complete = vi.fn().mockResolvedValueOnce(script).mockResolvedValueOnce(scene);
  const ttsAlign = vi.fn().mockResolvedValue(audio);
  const session = startSession({ irSection: { markdown: "Arrays" }, provider: { complete }, ttsAlign });
  expect((await session.next()).value).toMatchObject({ type: "scene", wavPath: audio.wavPath });
  expect(ttsAlign).toHaveBeenCalledWith(say, expect.objectContaining({ sceneId: "scene-1", signal: expect.any(AbortSignal) }));
  await session.return();
  expect(invoke).not.toHaveBeenCalled();
});

it("forwards cancellation without starting real work", async () => {
  const controller = new AbortController();
  controller.abort();
  const session = startSession({ irSection: { markdown: "Arrays" }, signal: controller.signal });
  await expect(session.next()).rejects.toMatchObject({ name: "AbortError" });
  expect(session.status()).toBe("aborted");
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects an empty section before starting work", () => {
  expect(() => startSession({ irSection: { markdown: "  " } })).toThrow(/section/i);
  expect(invoke).not.toHaveBeenCalled();
});
