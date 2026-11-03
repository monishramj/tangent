import { expect, it } from "vitest";
import fx from "../sidecar/contract/ping.json";
import type { Request, Response } from "./ipc";

it("ipc request shape matches the contract fixture", () => {
  const req: Request = { id: 1, method: "ping", params: {} };
  const res: Response = { id: 1, result: "pong" };
  expect(fx.request).toEqual(req);
  expect(fx.response).toEqual(res);
});
