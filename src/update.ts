import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

let pending: Promise<Update | null> | undefined;
let available: Update | null = null;
let installing = false;

/** Silent on launch; Settings can use the returned version to offer installation. */
export async function checkForUpdate(): Promise<Update | null> {
  if (available) return available;
  pending ??= check({ timeout: 15_000 });
  try {
    available = await pending;
    return available;
  } finally {
    pending = undefined;
  }
}

/** Call only from an explicit user action. Never scheduled by playback or launch. */
export async function installUpdate(): Promise<boolean> {
  if (installing) return false;
  installing = true;
  try {
    const update = await checkForUpdate();
    if (!update || !await ask(
      `Install Tangent ${update.version} and restart now? Finish playback and save your work first.`,
      { title: "Update Tangent", kind: "info", okLabel: "Install and restart", cancelLabel: "Later" },
    )) return false;
    await update.downloadAndInstall();
    await relaunch();
    return true;
  } finally {
    installing = false;
  }
}
