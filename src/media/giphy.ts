// GIPHY lookup for `gif` objects. Resolved once at generation time; the URL is saved in the bundle.
// No key (Settings -> GIPHY) = no lookup: the renderer shows a framed reaction card with the caption instead.
import { invoke } from "@tauri-apps/api/core";
import type { Scene } from "@motion/dsl/schema";

export type GifSearch = (query: string) => Promise<string | null>;
const BANNED = /\b(nsfw|sexy|gore|blood|drunk)\b/i;

// Secrets are an owner-only file in app data (the Keychain prompted for the login password on every unsigned rebuild). A non-secret localStorage flag says whether a
// key exists (the Settings UI reads only the flag). giphyKey runs at generation time only and reads the secret once per
// session even without the flag, so a key saved before the flag existed is still found.
export const GIPHY_FLAG = "tangent.giphy.set";
export function hasGiphyKey(): boolean {
  try { return localStorage.getItem(GIPHY_FLAG) === "1"; } catch { return false; }
}
function setFlag(on: boolean) {
  try { if (on) localStorage.setItem(GIPHY_FLAG, "1"); else localStorage.removeItem(GIPHY_FLAG); } catch { /* flag is a convenience */ }
}

let key: Promise<string | null> | undefined;
export const giphyKey = (): Promise<string | null> =>
  key ??= invoke<string | null>("get_secret", { name: "giphy" }).then(k => { setFlag(!!k); return k || null; }, () => null);
/** Store (non-empty) or delete (empty) the key, keep the flag in step, and cache the new value without re-reading. */
export async function saveGiphyKey(value: string): Promise<void> {
  await invoke("set_secret", { name: "giphy", value });
  setFlag(!!value);
  key = Promise.resolve(value || null);
}
export const resetGiphyKey = () => { key = undefined; };

/** GIPHY's most relevant hit for the query. Top-1, not a random pick from the top few: lower ranks drift off-topic. */
export function giphySearch(apiKey: string, fetchFn: typeof fetch = fetch): GifSearch {
  return async query => {
    if (BANNED.test(query)) return null;
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=3&rating=pg-13&lang=en`;
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const hits = ((await r.json()) as { data?: { images?: Record<string, { url?: string }> }[] }).data ?? [];
    const urls = hits.map(h => h.images?.downsized_medium?.url ?? h.images?.fixed_height?.url).filter((u): u is string => !!u);
    return urls[0] ?? null;
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
