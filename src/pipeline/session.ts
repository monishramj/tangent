import { providers } from "../llm/registry";
import { sidecarTts } from "./sidecarTts";
import { streamVideo } from "./streamVideo";

type StreamOptions = Parameters<typeof streamVideo>[0];

/** Start one IR section; consume with for-await and observe status() on the same stream. */
export function startSession({ irSection, provider = providers.claude, ttsAlign = sidecarTts, signal }: {
  irSection: { markdown: string };
  provider?: StreamOptions["provider"];
  ttsAlign?: StreamOptions["ttsAlign"];
  signal?: AbortSignal;
}) {
  if (!irSection.markdown.trim()) throw new Error("Section markdown must not be empty");
  return streamVideo({ sectionMarkdown: irSection.markdown, provider, ttsAlign, signal });
}
