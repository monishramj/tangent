import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import type { LLMProvider } from "./llm/provider";
import type { Annotation } from "./tutor/annotations";
import { beatStarts, stubProvider } from "./tutor/glue";
import { timeline } from "./stage/demo";
import App from "./App";

const annotate = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong") }));
vi.mock("./Stage", () => ({
  default: ({ annotateRef }: { annotateRef: RefObject<((a: Annotation[]) => void) | null> }) => {
    annotateRef.current = annotate;
    return null;
  },
}));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));

const play = vi.fn().mockResolvedValue(undefined);
const pause = vi.fn();
HTMLMediaElement.prototype.play = play;
HTMLMediaElement.prototype.pause = pause;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const reply = JSON.stringify({ answer: "Bigger child keeps the max on top.", annotations: [{ kind: "circle", target: "h.slot[0]" }, { kind: "circle", target: "nope" }] });
const provider = (impl: () => Promise<string>) => ({ complete: vi.fn(impl) }) as LLMProvider & { complete: ReturnType<typeof vi.fn> };

beforeEach(() => { annotate.mockClear(); play.mockClear(); pause.mockClear(); });
afterEach(cleanup);

const send = (q: string) => {
  fireEvent.change(screen.getByLabelText(/ask about this moment/i), { target: { value: q } });
  fireEvent.submit(screen.getByLabelText(/ask about this moment/i).closest("form")!);
};

it("opening Ask pauses; answer shows, annotations drawn; Resume seeks to the beat start, plays, clears", async () => {
  const p = provider(async () => reply);
  render(<App provider={p} />);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  play.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(pause).toHaveBeenCalled();

  send("Why the bigger child?");
  expect(screen.getByRole("status", { name: /thinking/i })).toBeTruthy();
  expect(await screen.findByText("Bigger child keeps the max on top.")).toBeTruthy();
  expect(p.complete).toHaveBeenCalledTimes(1);
  expect(annotate).toHaveBeenLastCalledWith([{ kind: "circle", target: "h.slot[0]" }]); // bad target dropped

  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(annotate).toHaveBeenLastCalledWith([]);
  expect(play).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

it("resume seeks to resumeTime(beatStarts, askedAt)", async () => {
  const starts = beatStarts(timeline);
  const seeks: number[] = [];
  const orig = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
  let cur = starts[1] + 0.7;
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => cur,
    set: (v: number) => { seeks.push(v); cur = v; },
  });
  try {
    render(<App provider={provider(async () => reply)} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    send("q");
    await screen.findByText("Bigger child keeps the max on top.");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(seeks[seeks.length - 1]).toBe(starts[1]);
  } finally {
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", orig);
  }
});

it("provider failure shows an error status and no annotations; can retry", async () => {
  const p = provider(async () => { throw new Error("boom"); });
  render(<App provider={p} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  send("q");
  await waitFor(() => expect(screen.getByRole("status", { name: /error/i }).textContent).toMatch(/couldn't answer/i));
  expect(annotate).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
  expect(screen.getByLabelText(/ask about this moment/i)).toBeTruthy();
});

it("injected stub provider answers", async () => {
  render(<App provider={stubProvider} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  send("q");
  expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
});
