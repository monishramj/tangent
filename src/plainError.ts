import { devlog } from "./devlog";

/** Plain user-facing text for a technical error; the raw detail goes to devlog only (principle 4). */
export function plainError(e: unknown, fallback = "Something went wrong. Try again."): string {
  const raw = e instanceof Error ? e.message : String(e);
  devlog(`error ${raw}`);
  if (/^The library has not loaded/.test(raw)) return raw; // already plain, app-authored
  if (/Unable to play scene|audio failed to load|MEDIA_ERR|Failed to fetch.*(wav|audio)/i.test(raw)) return "Couldn't load this scene's audio. Try again.";
  if (/Failed to fetch|NetworkError|network|offline|ENOTFOUND|timed? ?out/i.test(raw)) return "Couldn't reach the network. Check your connection and try again.";
  if (/ENOENT|No such file|not found/i.test(raw)) return "Couldn't find that file. It may have been moved or deleted.";
  if (/EACCES|permission denied|not permitted/i.test(raw)) return "Tangent doesn't have permission to open that file.";
  return fallback;
}
