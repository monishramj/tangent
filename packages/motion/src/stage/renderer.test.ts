import { afterEach, expect, it, vi } from "vitest";
import { Assets, CanvasTextMetrics, Container, Text, Texture, type Application } from "pixi.js";
import { Scene } from "../dsl/schema";
import { SceneRenderer } from "./renderer";
import { applyEventsAt } from "./scene";

afterEach(() => vi.restoreAllMocks());
it("smoke draws every visual, resizes, seeks and cleans up without a ticker", async () => {
  vi.spyOn(CanvasTextMetrics, "measureText").mockImplementation((text, style) => ({ width: text.length * Number(style.fontSize) * .6 }) as ReturnType<typeof CanvasTextMetrics.measureText>);
  vi.spyOn(Assets, "load").mockImplementation(async <T>() => Texture.EMPTY as unknown as T);
  const scene = Scene.parse({ scene: "smoke", objects: [
    { id: "flow", type: "flow", nodes: [{ id: "a", label: "CPU" }, { id: "b", label: "Memory" }], edges: [{ from: "a", to: "b", label: "data" }] },
    { id: "table", type: "table", headers: ["A", "B"], rows: [["1", "2"]], highlightRow: 0 },
    { id: "code", type: "code", lines: ["add x1, x2, x3", "ret"], highlight: [[0, 0], [1, 1]] },
    { id: "figure", type: "figure", src: "/image.png", focus: [[0, 0, .5, .5], [.5, .5, 1, 1]] },
    { id: "bits", type: "bits", bits: "010101", groups: [2, 4], label: "opcode" },
    { id: "stack", type: "stack", frames: [{ label: "main", items: ["x = 3"] }] },
    { id: "shape", type: "shape", shape: "rect", label: "A long label ".repeat(20) },
    { id: "array", type: "Array", init: ["a long array value", 2] },
    { id: "tree", type: "Tree", init: [3, 2, 4] },
    { id: "text", type: "text", text: "Hello world" },
    { id: "math", type: "Math", tex: "x^2" },
    { id: "arrow", type: "arrow", from: [.1, .1], to: [.9, .9] },
    { id: "elbow", type: "arrow", from: "shape", to: "icon", label: "data", route: "elbow", dashed: true },
    { id: "curve", type: "line", from: "shape", to: "person", route: "curve" },
    { id: "icon", type: "icon", name: "laptop", label: "Laptop" },
    { id: "emoji", type: "emoji", char: "🔥", label: "hot" },
    { id: "person", type: "person", pose: "think", label: "Me" },
    { id: "counter", type: "counter", from: 0, to: 1234, label: "users" },
    { id: "chart", type: "chart", kind: "bar", labels: ["a", "b"], values: [1, 3] },
    { id: "line", type: "chart", kind: "line", labels: ["a", "b"], values: [1, 3], x: .5, y: .5, width: .3, height: .2 },
    { id: "gif", type: "gif", query: "mind blown", caption: "wow" },
    { id: "ktext", type: "KineticText", text: "ONE TWO THREE", variant: "words" },
    { id: "stack", type: "KineticText", text: "ONE TWO", variant: "stack" },
    { id: "left", type: "text", text: "left", x: .1, y: .1, align: "left", size: .04 },
    { id: "db", type: "shape", shape: "cylinder", label: "DB", sublabel: "postgres", filled: true },
    { id: "alu", type: "shape", shape: "alu", label: "ALU" },
  ], beats: [] });
  const tl = { totalSec: 10, insertedSilences: [], events: [...scene.objects.map(o => ({ start: 0, end: 1, verb: "create" as const, target: o.id, args: {}, beat: 0 })), { start: 1, end: 2, verb: "pulse" as const, target: "elbow", args: {}, beat: 0 }] };
  const app = { stage: new Container(), screen: { width: 1280, height: 720 }, render: vi.fn() };
  const layer = document.createElement("div");
  const renderer = new SceneRenderer(app as unknown as Application, scene, layer, name => name === "--bg" ? "#000000" : "#ffffff");
  for (const time of [0, .2, .7, 1, 1.5, 5, .1]) renderer.draw(applyEventsAt(scene, tl, time));
  await Promise.resolve();
  app.screen.width = 400; app.screen.height = 800;
  renderer.draw(applyEventsAt(scene, tl, 4));
  expect(app.render).toHaveBeenCalled();
  expect(layer.children).toHaveLength(2); // Math + gif
  const root = app.stage.children[0] as Container;
  const box = root.children[8] as Container; // connectors are inserted at index 0, so the rect shape sits after the 3 arrows
  const label = box.children[1] as Text;
  expect(label.text.split("\n").length * Number(label.style.fontSize) * 1.15).toBeLessThanOrEqual(800*.24*.84);
  renderer.destroy();
  expect(layer.children).toHaveLength(0);
  expect(app.stage.children).toHaveLength(0);
});
