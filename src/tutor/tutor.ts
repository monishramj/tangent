import type { LLMProvider } from "../llm/provider";
import { checkAnnotations, type Annotation } from "@motion/annotations";

export type TutorContext = { prompt: string; ids: string[] };

export function buildTutorContext(i: {
  objects: { id: string; type: string; state?: string }[];
  transcript: string; // narration up to the current word
  section: string;
  priorQuestions: string[];
}): TutorContext {
  const prompt = [
    "You are a friendly tutor inside a lecture video the student paused. Answer the question directly in 1-3 short, plain sentences. Ground it in the section and what was just said; if the question goes beyond the section, say so briefly and still help.",
    'Also mark the scene. Reply with ONLY JSON: {"answer": string, "annotations": [{"kind": "circle"|"highlight"|"arrow-to"|"label", "target": <object id or id.slot[n]>, "text": <label only>}]}',
    "Targets must be ids from the scene objects below.",
    `Section:\n${i.section}`,
    `Narration so far:\n${i.transcript}`,
    "Scene objects:\n" + i.objects.map(o => `- ${o.id} (${o.type})${o.state ? ": " + o.state : ""}`).join("\n"),
    `Prior questions: ${i.priorQuestions.length ? i.priorQuestions.join(" | ") : "none"}`,
  ].join("\n\n");
  return { prompt, ids: i.objects.map(o => o.id) };
}

function parse(text: string): { answer: string; annotations: unknown[] } | null {
  const m = /\{[\s\S]*\}/.exec(text); // tolerate code fences / chatter
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (typeof j?.answer !== "string" || !j.answer) return null;
    return { answer: j.answer, annotations: Array.isArray(j.annotations) ? j.annotations : [] };
  } catch { return null; }
}

export type Turn = { role: "user" | "tutor"; text: string };

/** One answer in a thread: earlier turns ride along so follow-ups ("why?", "show me again") make sense. */
export async function ask(a: { question: string; context: TutorContext; provider: LLMProvider; history?: Turn[] }) {
  const history = a.history?.length ? `\n\nThis thread so far:\n${a.history.map(t => `${t.role === "user" ? "Student" : "Tutor"}: ${t.text}`).join("\n")}` : "";
  const prompt = `${a.context.prompt}${history}\n\nStudent question: ${a.question}`;
  let out = parse(await a.provider.complete(prompt));
  out ??= parse(await a.provider.complete(prompt + "\n\nYour last reply was not valid JSON. Reply with ONLY the JSON object."));
  if (!out) throw new Error("tutor: model returned invalid JSON twice");
  const { ok, dropped } = checkAnnotations(out.annotations, a.context.ids);
  return { answer: out.answer, annotations: ok as Annotation[], dropped };
}

export { resumeTime } from "@motion/player/queue";
// Glue (in the app): player.pause() on interrupt; after the answer's audio ends, player.seek(resumeTime(starts, t)); player.play().
