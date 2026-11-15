import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RenderPage } from "@/follow/types";
import Page from "./PdfPage";
import { devlog } from "@/devlog";

vi.mock("@/devlog", () => ({ devlog: vi.fn() }));
let intersect: (visible: boolean) => void;
vi.stubGlobal("IntersectionObserver", class {
  constructor(callback: IntersectionObserverCallback) {
    intersect = visible => callback([{ isIntersecting: visible }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
  observe() {} disconnect() {}
});
afterEach(cleanup);
const image = { url: "asset://page.png", width: 200, height: 100 };
function mount(renderPage: RenderPage) {
  return render(<Page path="/book.pdf" page={1} first aspect={2} width={300} onAspect={() => {}} root={{ current: null }} renderPage={renderPage} />);
}
it("logs the actual failure and retries on viewport re-entry", async () => {
  const renderPage = vi.fn<RenderPage>().mockRejectedValueOnce(new Error("PDFium unavailable")).mockResolvedValue(image);
  mount(renderPage);
  await screen.findByRole("status");
  expect(devlog).toHaveBeenCalledWith(expect.stringContaining("PDFium unavailable"));
  act(() => intersect(false));
  act(() => intersect(true));
  await screen.findByRole("img");
  expect(renderPage).toHaveBeenCalledTimes(2);
});
it("aborts scrolled-past requests and ignores late results", async () => {
  let resolve!: (result: typeof image) => void;
  const renderPage = vi.fn<RenderPage>(() => new Promise(r => { resolve = r; }));
  const view = mount(renderPage);
  const signal = renderPage.mock.calls[0][3]!;
  act(() => intersect(false));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(image));
  expect(screen.queryByRole("img")).toBeNull();
  act(() => intersect(true));
  expect(renderPage).toHaveBeenCalledTimes(2);
  const next = renderPage.mock.calls[1][3]!;
  view.unmount();
  expect(next.aborted).toBe(true);
});
it("re-requests a broken image once, then retries again on re-entry", async () => {
  const renderPage = vi.fn<RenderPage>().mockResolvedValue(image);
  mount(renderPage);
  fireEvent.error(await screen.findByRole("img"));
  await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
  expect((await screen.findByRole("img")).getAttribute("src")).toContain("retry=1");
  fireEvent.error(screen.getByRole("img"));
  await screen.findByRole("status");
  expect(renderPage).toHaveBeenCalledTimes(2);
  act(() => intersect(false));
  act(() => intersect(true));
  await screen.findByRole("img");
  expect(renderPage).toHaveBeenCalledTimes(3);
});
