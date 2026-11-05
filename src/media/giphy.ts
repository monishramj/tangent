// GIPHY lookup for `gif` objects. Resolved once at generation time; the URL is saved in the bundle.
// No key (Settings -> GIPHY) = no lookup: the renderer shows a framed reaction card with the caption instead.
import { invoke } from "@tauri-apps/api/core";
import type { Scene } from "@motion/dsl/schema";

export type GifSearch = (query: string) => Promise<string | null>;
const BANNED = /\b(nsfw|sexy|gore|blood|drunk)\b/i;

// The Keychain prompts on every read in unsigned dev builds, so a non-secret localStorage flag says whether a
// key exists. No flag = no Keychain access at all; with the flag, the key is read once per app session.
export const GIPHY_FLAG = "tangent.giphy.set";
export function hasGiphyKey(): boolean {
  try { return localStorage.getItem(GIPHY_FLAG) === "1"; } catch { return false; }
}
function setFlag(on: boolean) {
  try { if (on) localStorage.setItem(GIPHY_FLAG, "1"); else localStorage.removeItem(GIPHY_FLAG); } catch { /* flag is a convenience */ }
}

let key: Promise<string | null> | undefined;
export const giphyKey = (): Promise<string | null> => {
  if (!hasGiphyKey()) return Promise.resolve(null);
  return key ??= invoke<string | null>("get_secret", { name: "giphy" }).then(k => k || null, () => null);
};
/** Store (non-empty) or delete (empty) the key, keep the flag in step, and cache the new value without re-reading. */
export async function saveGiphyKey(value: string): Promise<void> {
  await invoke("set_secret", { name: "giphy", value });
  setFlag(!!value);
  key = Promise.resolve(value || null);
}
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
