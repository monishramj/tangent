// GIPHY lookup for `gif` objects. Resolved once at generation time; the URL is saved in the bundle.
// No key (Settings -> GIPHY) = no lookup: the renderer shows a framed reaction card with the caption instead.
import { invoke } from "@tauri-apps/api/core";
import type { Scene } from "../dsl/schema";

export type GifSearch = (query: string) => Promise<string | null>;
const BANNED = /\b(nsfw|sexy|gore|blood|drunk)\b/i;

let key: Promise<string | null> | undefined;
export const giphyKey = () => key ??= invoke<string | null>("get_secret", { name: "giphy" }).catch(() => null);
export const resetGiphyKey = () => { key = undefined; };

/** Top results for the query, one picked at random so repeated intents don't repeat the same gif. */
export function giphySearch(apiKey: string, fetchFn: typeof fetch = fetch, pick = Math.random): GifSearch {
  return async query => {
    if (BANNED.test(query)) return null;
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=8&rating=pg-13&lang=en`;
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const hits = ((await r.json()) as { data?: { images?: Record<string, { url?: string }> }[] }).data ?? [];
    const urls = hits.map(h => h.images?.downsized_medium?.url ?? h.images?.fixed_height?.url).filter((u): u is string => !!u);
    return urls.length ? urls[Math.floor(pick() * urls.length)] : null;
  };
}

/** Fill `src` on gif objects that only have a query. Failures leave the placeholder card. */
export async function resolveGifs(scene: Scene, search: GifSearch | null): Promise<void> {
  if (!search) return;
  await Promise.all(scene.objects.map(async o => {
    if (o.type !== "gif" || o.src || !o.query) return;
    try { o.src = (await search(o.query)) ?? undefined; } catch { /* keep the card */ }
  }));
}
