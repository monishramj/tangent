import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { installUpdate } from "./update";
import { resetBindings } from "./keybinds";
import { startMenuBridge, syncMenu } from "./menu";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("./update", () => ({ installUpdate: vi.fn() }));

beforeEach(() => { localStorage.clear(); resetBindings(); });
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; vi.clearAllMocks(); });

it("does nothing outside Tauri", () => {
  syncMenu({ player: true });
  startMenuBridge();
  expect(invoke).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

it("syncMenu sends the live default accelerators and screen state", () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  syncMenu({ player: true, textbook: true });
  expect(invoke).toHaveBeenCalledWith("sync_menu", {
    bindings: expect.objectContaining({ playPause: "Space", choosePdfs: "Mod+o", speedDown: "<" }),
    state: { player: true, textbook: true },
  });
});

it("routes a menu click through the same dispatchKeybind path a real key press uses, and non-keybind items separately", () => {
  // startMenuBridge is one-time; both assertions share the single subscription it creates.
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  startMenuBridge();
  const onMenu = vi.mocked(listen).mock.calls[0][1] as (e: { payload: string }) => void;

  const seen: string[] = [];
  window.addEventListener("keydown", e => seen.push(e.key));
  onMenu({ payload: "playPause" }); // default binding "Space"
  expect(seen).toEqual([" "]);

  onMenu({ payload: "checkForUpdates" }); // no keybind: routed straight to the update flow
  expect(installUpdate).toHaveBeenCalledTimes(1);
});
