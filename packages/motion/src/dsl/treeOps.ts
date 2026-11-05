import type { TreeOps } from "./trees/shared";

// File name is the kind; shared helpers have no default export.
const modules = import.meta.glob<{ default?: TreeOps }>("./trees/*.ts", { eager: true });
export const TREE_OPS: Record<string, TreeOps> = Object.fromEntries(
  Object.entries(modules).flatMap(([path, module]) => module.default
    ? [[path.slice("./trees/".length, -3), module.default]] : []),
);
