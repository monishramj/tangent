import { expect, it, vi } from "vitest";
import { giphySearch, resolveGifs } from "./giphy";
import type { Scene } from "../dsl/schema";

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
