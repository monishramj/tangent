import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Thread } from "@/storage/store";
import SidePanel from "./SidePanel";

vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

const thread = (o: Partial<Thread> = {}): Thread => ({ id: "t1", videoId: "v", t: 65, title: "Why swap?", messages: [{ role: "user", text: "Why swap?", at: 1 }, { role: "tutor", text: "To restore the heap.", at: 2 }], ...o });

function setup(over: Record<string, unknown> = {}) {
  const props = {
    tab: "ask" as const, onTab: vi.fn(), onClose: vi.fn(), time: 7,
    lines: [{ t: 0, say: "First line." }, { t: 4, say: "Second line." }, { t: 9, say: "Third line." }],
    threads: [] as Thread[], activeThread: null as string | null, onSelectThread: vi.fn(), onSend: vi.fn(), thinking: false,
    onSeek: vi.fn(), onResume: vi.fn(), ...over,
  };
  render(<SidePanel {...props} />);
  return props;
}

it("empty ask tab shows a prompt with the paused time", () => {
  setup();
  expect(screen.getByText(/Paused at 0:07/)).toBeTruthy();
});

it("Enter sends the trimmed question once; Shift+Enter and blank input do not; the draft clears", () => {
  const p = setup({ activeThread: null });
  const box = screen.getByLabelText("Ask about this moment") as HTMLTextAreaElement;
  fireEvent.keyDown(box, { key: "Enter" });
  expect(p.onSend).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: "  why?  " } });
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(p.onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter" });
  expect(p.onSend).toHaveBeenCalledWith("why?", null);
  expect(box.value).toBe("");
});

it("send is disabled while thinking, and a thinking status shows in a thread", () => {
  const p = setup({ threads: [thread()], activeThread: "t1", thinking: true });
  const box = screen.getByLabelText("Reply in thread");
  fireEvent.change(box, { target: { value: "more" } });
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(p.onSend).not.toHaveBeenCalled();
  expect(screen.getByRole("status", { name: "Thinking" })).toBeTruthy();
});

it("lists threads with reply counts and selects one", () => {
  const p = setup({ threads: [thread(), thread({ id: "t2", title: "Second", t: 3, messages: [{ role: "user", text: "Second", at: 1 }, { role: "tutor", text: "x", at: 2 }, { role: "user", text: "y", at: 3 }, { role: "tutor", text: "z", at: 4 }] })] });
  expect(screen.getByText("1:05 · 1 reply")).toBeTruthy();
  expect(screen.getByText("0:03 · 2 replies")).toBeTruthy();
  fireEvent.click(screen.getByText("Second"));
  expect(p.onSelectThread).toHaveBeenCalledWith("t2");
});

it("thread view: back, seek chip, and resume on the last tutor message; no Pin to notes", () => {
  const p = setup({ threads: [thread()], activeThread: "t1" });
  fireEvent.click(screen.getByRole("button", { name: "All questions" }));
  expect(p.onSelectThread).toHaveBeenCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: /▶ 1:05/ }));
  expect(p.onSeek).toHaveBeenCalledWith(65);
  expect(screen.queryByRole("button", { name: /Pin to notes/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
  expect(p.onResume).toHaveBeenCalledWith(65);
});

it("hides Resume on earlier tutor messages", () => {
  const t = thread({ messages: [...thread().messages, { role: "user", text: "and?", at: 3 }, { role: "tutor", text: "Also this.", at: 4 }] });
  setup({ threads: [t], activeThread: "t1" });
  expect(screen.getAllByRole("button", { name: /Resume/ })).toHaveLength(1);
});

it("transcript marks the current line, seeks on click, and interleaves threads", () => {
  const p = setup({ tab: "transcript", threads: [thread({ t: 5 })] });
  const items = screen.getAllByRole("listitem");
  expect(items.map(i => i.textContent)).toEqual(["0:00First line.", "0:04Second line.", "You askedWhy swap?", "0:09Third line."]);
  expect(screen.getByText("Second line.").closest("button")!.getAttribute("aria-current")).toBe("true");
  expect(screen.getByText("First line.").closest("button")!.getAttribute("aria-current")).toBe("false");
  fireEvent.click(screen.getByText("Third line."));
  expect(p.onSeek).toHaveBeenCalledWith(9);
  fireEvent.click(screen.getByText("Why swap?"));
  expect(p.onSelectThread).toHaveBeenCalledWith("t1");
  expect(p.onTab).toHaveBeenCalledWith("ask");
});

it("empty transcript shows a placeholder", () => {
  setup({ tab: "transcript", lines: [] });
  expect(screen.getByText(/transcript fills in/i)).toBeTruthy();
});

it("Ask and Transcript tabs, plus Checks when given; tabs switch; Escape and close button close", () => {
  const p = setup();
  expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["Ask", "Transcript"]);
  cleanup();
  setup({ checks: <p>checks list</p>, tab: "checks" });
  expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["Ask", "Transcript", "Checks"]);
  expect(screen.getByText("checks list")).toBeTruthy();
  cleanup();
  Object.assign(p, setup());
  fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
  expect(p.onTab).toHaveBeenCalledWith("transcript");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(p.onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
  expect(p.onClose).toHaveBeenCalledTimes(2);
});

it("tutor answers render inline LaTeX with KaTeX and keep markup as text", () => {
  const t = thread({ messages: [{ role: "user", text: "<b>hi</b>", at: 1 }, { role: "tutor", text: "It costs $n \\log n$.\n<script>alert(1)</script>", at: 2 }] });
  setup({ threads: [t], activeThread: "t1" });
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector(".katex")).toBeTruthy();
  expect(dialog.querySelector("script")).toBeNull();
  expect(dialog.querySelector("b")).toBeNull();
  expect(dialog.textContent).toContain("<script>alert(1)</script>");
  expect(dialog.textContent).toContain("<b>hi</b>");
});
