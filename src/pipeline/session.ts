import { convertFileSrc } from "@tauri-apps/api/core";
import { providers } from "../llm/registry";
import { sidecarTts } from "./sidecarTts";
import { streamVideo } from "./streamVideo";

type StreamOptions = Parameters<typeof streamVideo>[0];

/** Start one IR section; consume with for-await and observe status() on the same stream. */
export function startSession({ irSection, provider = providers.claude, ttsAlign = sidecarTts, signal, onStatus, onProgress, gifSearch }: {
  irSection: { markdown: string; figures?: { id: string; caption: string; image_path: string }[]; exercises?: StreamOptions["exercises"] };
  onProgress?: StreamOptions["onProgress"];
  gifSearch?: StreamOptions["gifSearch"];
  provider?: StreamOptions["provider"];
  ttsAlign?: StreamOptions["ttsAlign"];
  signal?: AbortSignal;
  onStatus?: StreamOptions["onStatus"];
}) {
  if (!irSection.markdown.trim()) throw new Error("Section markdown must not be empty");
  const figures = (irSection.figures ?? []).map(f => ({ id: f.id, caption: f.caption, src: convertFileSrc(f.image_path) }));
  return streamVideo({ sectionMarkdown: irSection.markdown, figures, exercises: irSection.exercises, provider, ttsAlign, signal, onStatus, onProgress, gifSearch });
}
