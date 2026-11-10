// Human templates (antigravity): picture-first layouts (not box-and-arrow). Same contract as vocabTemplates.ts.
import { z } from "zod";
import { type C } from "../tplkit";

export const TEMPLATES = {} as const;
type T = typeof TEMPLATES;
export const VARIANTS: Record<keyof T, string[]> = {};
export const EXPAND: { [K in keyof T]: (c: C, d: z.infer<T[K]>, v: string) => void } = {};
export const SAMPLES: Record<keyof T, unknown> = {};
export const GUIDE = "";
