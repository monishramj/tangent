import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ping } from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong") }));

it("ping calls sidecar_call and returns the result", async () => {
  expect(await ping()).toBe("pong");
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "ping", params: {} });
});
