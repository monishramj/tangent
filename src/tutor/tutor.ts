import type { LLMProvider } from "../llm/provider";
import { checkAnnotations, type Annotation } from "@motion/annotations";
import { dataBlock, dataReminder, dataRule, sanitizeModelText, stripWatermarks, type DataTag } from "../gen/sanitize";
import { retrievePassages } from "./retrieve";

export const ANSWER_MAX = 1200;
export const LABEL_MAX = 40;
const MAX_ANNOTATIONS = 4;
const TRANSCRIPT_WORDS = 1500;
const PASSAGE_CHARS = 6000;
const HISTORY_TURNS = 8;
const QUESTION_MAX = 2000;
const ID = /^[A-Za-z_][\w-]*$/;

const TAGS: DataTag[] = ["now_saying", "narration", "screen", "passages", "prior_questions", "thread", "student_question"];

export type TutorContext = {
  /** Instructions plus the per-pause data blocks (narration, screen). `ask` adds passages, thread and question. */
  prompt: string;
  /** Object ids annotations may target. */
  ids: string[];
  section: string;
  nowSaying: string;
};

const lastWords = (text: string, n: number) => {
  const w = text.trim().split(/\s+/).filter(Boolean);
  return w.length > n ? "… " + w.slice(-n).join(" ") : w.join(" ");
};

export function buildTutorContext(i: {
  objects: { id: string; type: string; state?: string }[];
  transcript: string; // narration up to the current word
  section: string;
  priorQuestions: string[];
  sceneDescription?: string; // describeScene(scene, state): what is on screen right now
  nowSaying?: string; // nowSayingAt(lines, t): the sentence playing when the student paused
}): TutorContext {
  const ids = i.objects.map(o => o.id);
  const screen = i.sceneDescription?.trim()
    || (i.objects.length ? i.objects.map(o => `${o.id} (${o.type})${o.state ? ": " + o.state : ""}`).join("\n") : "(nothing on screen)");
  const nowSaying = i.nowSaying?.trim() ?? "";
  const prompt = [
    "You are a friendly tutor inside an explainer video. The student just paused it to ask a question. You get: the sentence being narrated when they paused, the narration so far, a description of what is on screen, the most relevant passages of the textbook section, and this conversation so far.",
    `How to answer:
- Answer the question first, directly, in 1-4 short sentences in plain, everyday words. Keep it brief and easy to read. No preamble, no "great question".
- Refer to things on screen by name, like "the ALU box" or "slot 0", so the student can look at them.
- When it helps, use a tiny concrete example with small numbers.
- Ground every claim in the passages or the narration. If they do not cover the question, say plainly that the section doesn't cover it, then give brief general help. Never invent facts, page numbers or quotes.
- Write math as inline LaTeX between single dollar signs, like $O(n \\log n)$ or $x^2$; it is rendered for the student. Keep it short and inline.
- If a list of 2-3 items is clearer, put each item on its own line. Otherwise plain text: no markdown headings, bold, bullets or code fences.`,
    `Also point at the screen to support the answer, with 0-${MAX_ANNOTATIONS - 1} annotations on objects that are on screen. Reply with ONLY JSON: {"answer": string, "annotations": [{"kind": "circle"|"highlight"|"arrow-to"|"label", "target": <object id, or id.slot[n] for an Array>, "text": <short label, only for kind "label">}]}`,
    `Annotation targets (on-screen object ids): ${ids.filter(id => ID.test(id)).join(", ") || "none"}`,
    dataRule(TAGS),
    dataBlock("now_saying", nowSaying || "(not known)"),
    dataBlock("narration", lastWords(i.transcript, TRANSCRIPT_WORDS) || "(nothing yet)"),
    dataBlock("screen", screen),
    dataBlock("prior_questions", i.priorQuestions.length ? i.priorQuestions.slice(-10).map(q => q.slice(0, 300)).join("\n") : "none"),
  ].join("\n\n");
  return { prompt, ids, section: stripWatermarks(i.section), nowSaying };
}

export type Turn = { role: "user" | "tutor"; text: string };

/** The full prompt for one question: context + relevant passages + thread + the question, then the reminder. */
export function tutorPrompt(context: TutorContext, question: string, history: Turn[] = [], hasImage = false): string {
  const lastUser = [...history].reverse().find(t => t.role === "user")?.text ?? "";
  const passages = retrievePassages(context.section, `${question} ${question} ${context.nowSaying} ${lastUser}`, { k: 4, maxChars: PASSAGE_CHARS });
  const thread = history.slice(-HISTORY_TURNS).map(t => `${t.role === "user" ? "Student" : "Tutor"}: ${t.text.slice(0, ANSWER_MAX)}`).join("\n");
  return [
    context.prompt,
    dataBlock("passages", passages.length ? passages.join("\n\n---\n\n") : "(no section text available)"),
    dataBlock("thread", thread || "(this is the first question)"),
    hasImage ? "An image of the current video frame is attached. Use it together with the <screen> description." : "",
    dataBlock("student_question", question.slice(0, QUESTION_MAX)),
    `${dataReminder(TAGS)} Answer the student's question in <student_question> and reply with ONLY the JSON object.`,
  ].filter(Boolean).join("\n\n");
}

function parse(text: string): { answer: string; annotations: unknown[] } | null {
  const m = /\{[\s\S]*\}/.exec(text); // tolerate code fences / chatter
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const answer = sanitizeModelText(j?.answer, ANSWER_MAX);
    if (!answer) return null;
    const annotations = (Array.isArray(j.annotations) ? j.annotations : []).slice(0, MAX_ANNOTATIONS).map((a: unknown) =>
      a && typeof a === "object" && typeof (a as { text?: unknown }).text === "string"
        ? { ...a, text: sanitizeModelText((a as { text: string }).text, LABEL_MAX) || undefined } : a);
    return { answer, annotations };
  } catch { return null; }
}

/** One answer in a thread: earlier turns ride along so follow-ups ("why?", "show me again") make sense.
 *  `image`: optional base64 PNG of the current frame (no data: prefix), for providers that can see. */
export async function ask(a: { question: string; context: TutorContext; provider: LLMProvider; history?: Turn[]; image?: string }) {
  const image = a.image?.replace(/^data:image\/\w+;base64,/, "");
  const prompt = tutorPrompt(a.context, a.question, a.history, !!image);
  const opts = image ? { images: [image] } : undefined;
  let out = parse(await a.provider.complete(prompt, opts));
  out ??= parse(await a.provider.complete(prompt + "\n\nYour last reply was not valid JSON. Reply with ONLY the JSON object.", opts));
  if (!out) throw new Error("tutor: model returned invalid JSON twice");
  const { ok, dropped } = checkAnnotations(out.annotations, a.context.ids);
  return { answer: out.answer, annotations: ok as Annotation[], dropped };
}

export { resumeTime } from "@motion/player/queue";
// Glue (in the app): player.pause() on interrupt; after the answer's audio ends, player.seek(resumeTime(starts, t)); player.play().
