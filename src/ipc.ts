import { invoke } from "@tauri-apps/api/core";

export const ping = () => invoke<string>("sidecar_call", { method: "ping", params: {} });
