//! Native macOS menu bar. Accelerators and enabled state come from the frontend keybinds
//! registry (`src/keybinds.ts`) and the current screen; `sync` rebuilds the whole menu
//! (cheap, only happens on binding/screen changes) rather than tracking item handles.
use std::collections::HashMap;
use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

/// Action ids shared with `src/keybinds.ts`'s `ActionId` that also appear as menu items.
/// Clicking any of these emits `menu` with this id; the frontend replays it through the
/// same `dispatchKeybind` path a real key press uses, so there is one handling code path.
pub const KEYBIND_ACTIONS: &[&str] = &[
    "playPause", "seekBack", "seekForward", "speedDown", "speedUp", "captions",
    "ask", "transcript", "textbook", "checks", "newFolder", "choosePdfs", "fullscreen", "home", "settings",
];
/// Menu-only id with no keybind: routed to `installUpdate()` in `src/update.ts`.
const CHECK_UPDATES: &str = "checkForUpdates";
/// Menu-only id with no keybind: opens the repo in the default browser.
const GITHUB: &str = "github";
const GITHUB_URL: &str = "https://github.com/monishramj/tangent";

/// Which screen-dependent items are enabled. Mirrors the handler guards in
/// `src/player/PlayerScreen.tsx`'s `useKeybinds` call: `blocked` is a checkpoint/quiz.
#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct MenuState {
    #[serde(default)]
    pub player: bool,
    #[serde(default)]
    pub blocked: bool,
    #[serde(default)]
    pub textbook: bool,
    #[serde(default)]
    pub checks: bool,
}

fn item_enabled(id: &str, s: &MenuState) -> bool {
    match id {
        "playPause" | "seekBack" | "seekForward" | "ask" | "transcript" => s.player && !s.blocked,
        "textbook" => s.player && !s.blocked && s.textbook,
        "checks" => s.player && !s.blocked && s.checks,
        "captions" | "speedDown" | "speedUp" => s.player,
        _ => true,
    }
}

/// `src/keybinds.ts` binding syntax (e.g. `"Mod+Shift+n"`, `"<"`, `"ArrowLeft"`) to muda's
/// accelerator syntax (e.g. `"CmdOrCtrl+Shift+N"`). Infallible: unrecognized keys pass through
/// uppercased, and `MenuItemBuilder::accelerator` silently drops anything that fails to parse.
fn accelerator(binding: &str) -> String {
    let mut parts: Vec<&str> = binding.split('+').collect();
    let key = parts.pop().unwrap_or_default();
    let mut mods: Vec<String> = parts
        .into_iter()
        .map(|m| match m {
            "Mod" => "CmdOrCtrl".to_string(),
            "Meta" => "Cmd".to_string(),
            other => other.to_string(), // Ctrl, Alt, Shift already match muda's names
        })
        .collect();
    let key = match key {
        "Space" => "Space".to_string(),
        "ArrowLeft" => "Left".to_string(),
        "ArrowRight" => "Right".to_string(),
        "ArrowUp" => "Up".to_string(),
        "ArrowDown" => "Down".to_string(),
        "," => "Comma".to_string(),
        "[" => "BracketLeft".to_string(),
        "]" => "BracketRight".to_string(),
        // Shifted punctuation: the JS binding is the literal character, muda wants the
        // unshifted physical key plus an explicit Shift modifier.
        "<" => {
            mods.push("Shift".to_string());
            "Comma".to_string()
        }
        ">" => {
            mods.push("Shift".to_string());
            "Period".to_string()
        }
        k if k.chars().count() == 1 => k.to_uppercase(),
        k => k.to_string(),
    };
    mods.push(key);
    mods.join("+")
}

/// Default bindings mirrored from `src/keybinds.ts`'s `defaultBindings` (first entry per
/// action), used only to build the menu before the frontend's first `sync_menu` call.
fn default_bindings() -> HashMap<String, String> {
    [
        ("playPause", "Space"), ("seekBack", "ArrowLeft"), ("seekForward", "ArrowRight"),
        ("speedDown", "<"), ("speedUp", ">"), ("captions", "c"), ("ask", "a"),
        ("transcript", "t"), ("textbook", "b"), ("checks", "q"), ("newFolder", "Mod+Shift+n"),
        ("choosePdfs", "Mod+o"), ("fullscreen", "f"), ("home", "Mod+["), ("settings", "Mod+,"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn keybind_item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    bindings: &HashMap<String, String>,
    state: &MenuState,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(id, label).enabled(item_enabled(id, state));
    if let Some(binding) = bindings.get(id) {
        builder = builder.accelerator(accelerator(binding));
    }
    builder.build(app)
}

/// Builds the whole native menu bar from scratch.
pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    bindings: &HashMap<String, String>,
    state: &MenuState,
) -> tauri::Result<Menu<R>> {
    let key = |id: &str, label: &str| keybind_item(app, id, label, bindings, state);

    // macOS renders the first top-level submenu as the bold application menu regardless of
    // its title; "Tangent" is just the label shown in code.
    let app_menu = SubmenuBuilder::new(app, "Tangent")
        .about(Some(
            AboutMetadataBuilder::new()
                .name(Some("Tangent"))
                .version(Some(app.package_info().version.to_string()))
                .icon(app.default_window_icon().cloned())
                .build(),
        ))
        .separator()
        .item(&MenuItemBuilder::with_id(CHECK_UPDATES, "Check for Updates…").build(app)?)
        .separator()
        .item(&key("settings", "Settings…")?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&key("choosePdfs", "Add PDFs…")?)
        .item(&key("newFolder", "New Folder")?)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let panels_menu = SubmenuBuilder::new(app, "Panels")
        .enabled(state.player)
        .item(&key("ask", "Ask")?)
        .item(&key("transcript", "Transcript")?)
        .item(&key("textbook", "Textbook")?)
        .item(&key("checks", "Checks")?)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&key("captions", "Toggle Captions")?)
        .separator()
        .item(&panels_menu)
        .separator()
        .item(&key("fullscreen", "Enter Full Screen")?)
        .separator()
        .item(&key("home", "Back / Home")?)
        .build()?;

    let playback_menu = SubmenuBuilder::new(app, "Playback")
        .enabled(state.player)
        .item(&key("playPause", "Play/Pause")?)
        .separator()
        .item(&key("seekBack", "Skip Back")?)
        .item(&key("seekForward", "Skip Forward")?)
        .separator()
        .item(&key("speedDown", "Speed Down")?)
        .item(&key("speedUp", "Speed Up")?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .separator()
        .bring_all_to_front()
        .build()?;

    // Naming the submenu "Help" makes macOS pick it up as the system Help menu automatically.
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id(GITHUB, "Tangent on GitHub").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &playback_menu, &window_menu, &help_menu])
        .build()
}

/// Rebuilds and installs the menu. Called once at launch with defaults, then by the
/// `sync_menu` command whenever bindings or the active screen change.
pub fn sync<R: Runtime>(app: &AppHandle<R>, bindings: &HashMap<String, String>, state: &MenuState) -> tauri::Result<()> {
    let menu = build(app, bindings, state)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    sync(app, &default_bindings(), &MenuState::default())
}

/// Routes a menu click: GitHub opens the browser directly (no keybind), everything else
/// (check-updates and every `KEYBIND_ACTIONS` id) is forwarded to the frontend as one event,
/// which replays it through `dispatchKeybind` — the same path a real key press uses.
pub fn on_click<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == GITHUB {
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(GITHUB_URL).spawn();
        return;
    }
    if id == CHECK_UPDATES || KEYBIND_ACTIONS.contains(&id) {
        let _ = app.emit("menu", id);
    }
}

#[tauri::command]
pub fn sync_menu(app: AppHandle, bindings: HashMap<String, String>, state: MenuState) -> Result<(), String> {
    sync(&app, &bindings, &state).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accelerators_match_default_bindings() {
        assert_eq!(accelerator("Space"), "Space");
        assert_eq!(accelerator("ArrowLeft"), "Left");
        assert_eq!(accelerator("<"), "Shift+Comma");
        assert_eq!(accelerator(">"), "Shift+Period");
        assert_eq!(accelerator("c"), "C");
        assert_eq!(accelerator("Mod+Shift+n"), "CmdOrCtrl+Shift+N");
        assert_eq!(accelerator("Mod+o"), "CmdOrCtrl+O");
        assert_eq!(accelerator("Mod+["), "CmdOrCtrl+BracketLeft");
        assert_eq!(accelerator("Mod+,"), "CmdOrCtrl+Comma");
    }

    #[test]
    fn enabled_state_matches_player_screen_guards() {
        let idle = MenuState::default();
        let playing = MenuState { player: true, ..Default::default() };
        let checkpoint = MenuState { player: true, blocked: true, ..Default::default() };
        let with_extras = MenuState { player: true, textbook: true, checks: true, ..Default::default() };

        assert!(!item_enabled("playPause", &idle));
        assert!(item_enabled("playPause", &playing));
        assert!(!item_enabled("playPause", &checkpoint)); // checkpoint blocks seeking/play
        assert!(item_enabled("speedUp", &checkpoint)); // speed stays live during a checkpoint
        assert!(!item_enabled("textbook", &playing)); // no textbook for this source
        assert!(item_enabled("textbook", &with_extras));
        assert!(!item_enabled("checks", &playing));
        assert!(item_enabled("checks", &with_extras));
        assert!(item_enabled("home", &idle)); // always available, like the real Back button
    }

    // `build()` itself isn't unit-testable: muda creates real NSMenuItems and panics unless
    // called on the actual OS main thread, which a `cargo test` process doesn't run on (even
    // with `tauri::test::mock_app`). Verified instead by launching the app (see worker report).
    #[test]
    fn every_keybind_action_has_a_unique_default_binding() {
        let defaults = default_bindings();
        let mut seen = std::collections::HashSet::new();
        for action in KEYBIND_ACTIONS {
            assert!(seen.insert(*action), "duplicate action id {action}");
            assert!(defaults.contains_key(*action), "no default binding for {action}");
        }
    }
}
