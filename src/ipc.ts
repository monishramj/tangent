import { invoke } from "@tauri-apps/api/core";

export const ping = () => invoke<string>("sidecar_call", { method: "ping", params: {} });

export type Request = { id: number; method: string; params: Record<string, unknown> };
export type Response = { id: number | null; result?: unknown; error?: string };
