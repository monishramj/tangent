import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

it("folder emoji render grayscale", () => {
  const css = read("src/home/views.css");
  for (const cls of [".tl-heading-emoji", ".tl-folder-emoji"]) expect(css.match(new RegExp(`\\${cls} \\{[^}]*\\}`))![0]).toContain("grayscale(1)");
});

it("dev CSP allows blob: fetches (player fixture) while the shipped CSP does not", () => {
  expect(read("vite.config.ts")).toMatch(/"connect-src": `[^`]*blob:`/);
  expect(JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp["connect-src"]).not.toContain("blob:");
});
