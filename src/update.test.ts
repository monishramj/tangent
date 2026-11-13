import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), ask: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
it("checks silently and shares concurrent launch/manual checks", async () => {
  mocks.check.mockResolvedValue({ version: "0.2.0" });
  const { checkForUpdate } = await import("./update");
  await Promise.all([checkForUpdate(), checkForUpdate()]);
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(mocks.ask).not.toHaveBeenCalled();
});
it("does not download when installation is declined", async () => {
  const downloadAndInstall = vi.fn();
  mocks.check.mockResolvedValue({ version: "0.2.0", downloadAndInstall });
  mocks.ask.mockResolvedValue(false);
  expect(await (await import("./update")).installUpdate()).toBe(false);
  expect(downloadAndInstall).not.toHaveBeenCalled();
  expect(mocks.relaunch).not.toHaveBeenCalled();
});
it("installs and relaunches only after confirmation; blocks concurrent installs", async () => {
  const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({ version: "0.2.0", downloadAndInstall });
  mocks.ask.mockResolvedValue(true);
  const { installUpdate } = await import("./update");
  expect(await Promise.all([installUpdate(), installUpdate()])).toEqual([true, false]);
  expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  expect(mocks.relaunch).toHaveBeenCalledTimes(1);
});
it("does not relaunch after an installation error and allows a retry", async () => {
  const downloadAndInstall = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({ version: "0.2.0", downloadAndInstall });
  mocks.ask.mockResolvedValue(true);
  const { installUpdate } = await import("./update");
  await expect(installUpdate()).rejects.toThrow("network");
  expect(mocks.relaunch).not.toHaveBeenCalled();
  expect(await installUpdate()).toBe(true);
});
