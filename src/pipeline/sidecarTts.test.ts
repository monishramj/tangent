// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sidecarTts } from "./sidecarTts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/path", () => ({ tempDir: async () => "/tmp", join: async (...parts: string[]) => parts.join("/") }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

it("uses unique temp WAVs, a long timeout, and converts the response for playback", async () => {
  vi.mocked(invoke).mockImplementation(async (_cmd, args) => ({
    wav_path: (args as { params: { out_path: string } }).params.out_path,
    sec: 1, words: [{ word: "Hello.", start: 0, end: 1 }],
  }));
  const first = await sidecarTts("Hello.");
  const second = await sidecarTts("Hello.");
  expect(first.wavPath).toMatch(/^asset:\/\/\/tmp\/tangent-.*\.wav$/);
  expect(second.wavPath).not.toBe(first.wavPath);
  expect(first.sec).toBe(1);
  expect(invoke).toHaveBeenCalledWith("sidecar_call", {
    method: "tts_align", params: { text: "Hello.", out_path: first.wavPath.slice("asset://".length), voice: "af_heart" }, timeoutMs: 300_000,
  });
});

it("propagates transport failures", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("tts offline"));
  await expect(sidecarTts("Hello.")).rejects.toThrow("tts offline");
});

it.each([null, { wav_path: "/wrong.wav", sec: 1, words: [] }, { wav_path: 42 }, { wav_path: "/wrong.wav", sec: 1, words: [{ word: "Hello.", start: 0, end: 1 }] }])("rejects malformed alignment responses: %j", async response => {
  vi.mocked(invoke).mockResolvedValue(response);
  await expect(sidecarTts("Hello.")).rejects.toThrow();
});

it("rejects empty text and pre-aborted work before IPC", async () => {
  await expect(sidecarTts("  ")).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(sidecarTts("Hello.", { sceneId: "s", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});
