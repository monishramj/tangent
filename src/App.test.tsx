import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong") }));
vi.mock("./Stage", () => ({ default: () => null })); // jsdom has no WebGL
vi.mock("@/components/SplitText", () => ({ default: ({ text }: { text: string }) => <h1>{text}</h1> })); // gsap needs a real browser

it("renders the title and the sidecar reply", async () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Tangent" })).toBeTruthy();
  expect((await screen.findByRole("status")).textContent).toBe("sidecar: pong");
});
