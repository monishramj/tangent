import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DetailLevel } from "../src/gen/script";

export type Golden = {
  name: string; ir: string; section: string; detail?: DetailLevel;
  pdf?: string; pages?: [number, number];
  expected?: { facts: string[]; numbers: number[] };
};
export type Section = { id: string; markdown?: string; passages?: { id: string; markdown: string }[]; children?: Section[] };

export function readManifest(path: string, optional = false): Golden[] {
  if (optional && !existsSync(path)) {
    console.warn(`skip local eval manifest: ${path} missing`);
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readSection(g: Golden, appData: string): Section | undefined {
  const path = g.ir.startsWith("appdata:") ? join(appData, g.ir.slice(8)) : resolve(g.ir);
  if (!existsSync(path)) {
    console.warn(`skip ${g.name}: ${path} missing`);
    return;
  }
  const find = (sections: Section[]): Section | undefined => {
    for (const s of sections) {
      if (s.id === g.section) return s;
      const child = find(s.children ?? []);
      if (child) return child;
    }
  };
  const section = find(JSON.parse(readFileSync(path, "utf8")).sections);
  if (!section?.markdown) console.warn(`skip ${g.name}: no section ${g.section}`);
  return section?.markdown ? section : undefined;
}

export class MissingRecording extends Error {}
