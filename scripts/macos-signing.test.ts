import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// P0 (2026-11-16): hardened runtime on the ad-hoc build silenced audio in the installed app.
it("ad-hoc macOS signing does not enable entitlements or hardened runtime", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const mac = conf.bundle?.macOS ?? {};
  if (mac.signingIdentity === "-") {
    expect(mac.entitlements).toBeUndefined();
    expect(mac.hardenedRuntime).not.toBe(true);
    expect(mac.hardenedRuntime).toBeUndefined();
  }
});
