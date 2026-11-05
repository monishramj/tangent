import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { GIPHY_FLAG, giphyKey, giphySearch, hasGiphyKey, resetGiphyKey, resolveGifs, saveGiphyKey } from "./giphy";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { localStorage.clear(); resetGiphyKey(); vi.mocked(invoke).mockReset(); });
import type { Scene } from "@motion/dsl/schema";

it("searches GIPHY and fills gif srcs", async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: [{ images: { downsized_medium: { url: "https://g/1.gif" } } }] })));
  const scene = { scene: "s", beats: [], objects: [{ id: "g", type: "gif", query: "mind blown" }] } as unknown as Scene;
  await resolveGifs(scene, giphySearch("KEY", fetchFn as unknown as typeof fetch, () => 0));
  expect((scene.objects[0] as { src?: string }).src).toBe("https://g/1.gif");
  expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain("q=mind%20blown");
});

it("skips banned queries and survives failures", async () => {
  const search = giphySearch("K", (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
  expect(await giphySearch("K", fetch)("nsfw stuff")).toBeNull();
  const scene = { scene: "s", beats: [], objects: [{ id: "g", type: "gif", query: "wow" }] } as unknown as Scene;
  await resolveGifs(scene, search);
  expect((scene.objects[0] as { src?: string }).src).toBeUndefined();
});

it("never touches the keychain when the flag is absent", async () => {
  expect(hasGiphyKey()).toBe(false);
  expect(await giphyKey()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("with the flag, reads the keychain once per session", async () => {
  localStorage.setItem(GIPHY_FLAG, "1");
  vi.mocked(invoke).mockResolvedValue("K");
  expect(await giphyKey()).toBe("K");
  expect(await giphyKey()).toBe("K");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("get_secret", { name: "giphy" });
});

it("a keychain error reads as no key", async () => {
  localStorage.setItem(GIPHY_FLAG, "1");
  vi.mocked(invoke).mockRejectedValue("no keyring backend");
  expect(await giphyKey()).toBeNull();
});

it("saving sets the flag and caches the key; removing clears both", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  await saveGiphyKey("abc");
  expect(localStorage.getItem(GIPHY_FLAG)).toBe("1");
  expect(await giphyKey()).toBe("abc");
  expect(invoke).toHaveBeenCalledTimes(1); // only set_secret, no re-read
  await saveGiphyKey("");
  expect(localStorage.getItem(GIPHY_FLAG)).toBeNull();
  expect(await giphyKey()).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith("set_secret", { name: "giphy", value: "" });
});

it("a failed save leaves the flag alone", async () => {
  vi.mocked(invoke).mockRejectedValue("denied");
  await expect(saveGiphyKey("abc")).rejects.toBe("denied");
  expect(hasGiphyKey()).toBe(false);
});
