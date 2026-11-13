import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dispatchBinding, getBinding, subscribeKeybinds, type ActionId } from "./keybinds";
import { installUpdate } from "./update";

/** Action ids with a native menu item; mirrors `KEYBIND_ACTIONS` in `src-tauri/src/menu.rs`. */
const MENU_ACTIONS: ActionId[] = [
  "playPause", "seekBack", "seekForward", "speedDown", "speedUp", "captions",
  "ask", "transcript", "textbook", "checks", "newFolder", "choosePdfs", "fullscreen", "home", "settings",
];

/** Which screen-dependent menu items are enabled; mirrors `MenuState` in `src-tauri/src/menu.rs`. */
export type MenuState = { player: boolean; blocked?: boolean; textbook?: boolean; checks?: boolean };

const inTauri = () => "__TAURI_INTERNALS__" in window;
let last: MenuState = { player: false };

/** Push the live keybinds + current screen to the native menu (accelerators, enabled items). */
export function syncMenu(state: MenuState) {
  last = state;
  if (!inTauri()) return;
  const bindings = Object.fromEntries(MENU_ACTIONS.flatMap(id => {
    const binding = getBinding(id)[0];
    return binding ? [[id, binding]] : [];
  }));
  void invoke("sync_menu", { bindings, state }).catch(() => {});
}

let started = false;
/** One-time bridge: native menu clicks replay through `dispatchKeybind`, the same path a
 * real key press uses, so there is one handling code path and never a double fire. */
export function startMenuBridge() {
  if (started || !inTauri()) return;
  started = true;
  subscribeKeybinds(() => syncMenu(last));
  void listen<string>("menu", event => {
    if (event.payload === "checkForUpdates") { void installUpdate(); return; }
    const binding = getBinding(event.payload as ActionId)[0];
    if (binding) dispatchBinding(binding);
  });
}
