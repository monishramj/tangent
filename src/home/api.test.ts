import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ingestPdf, listSections, sectionText } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("r") }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn().mockResolvedValue("/data"), join: vi.fn(async (...p: string[]) => p.join("/")) }));

it("wraps ingest_pdf and list_sections over sidecar_call", async () => {
  await ingestPdf("/a.pdf");
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "ingest_pdf", params: { path: "/a.pdf" } });
  const ir = { sections: [] };
  await listSections(ir);
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "list_sections", params: { ir } });
});

it("loads section markdown through section_text", async () => {
  const ir = { sections: [] };
  await sectionText(ir, "s1");
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "section_text", params: { ir, id: "s1" } });
});

describe("sectionFigures", () => {
  it("collects figures from a section and its descendants", async () => {
    const { sectionFigures } = await import("./api");
    const fig = (id: string) => ({ id, caption: id, image_path: `/${id}.png` });
    const child = { id: "c", title: "c", level: 3, anchors: [], children: [], figures: [fig("f2")] };
    const ir = { sections: [{ id: "p", title: "p", level: 2, anchors: [], children: [child], figures: [fig("f1")] }] };
    expect(sectionFigures(ir, "p").map(f => f.id)).toEqual(["f1", "f2"]);
    expect(sectionFigures(ir, "c").map(f => f.id)).toEqual(["f2"]);
    expect(sectionFigures(ir, "nope")).toEqual([]);
  });
});

it("passes assets_dir, pdf_info and figuresDir", async () => {
  const { pdfInfo, figuresDir } = await import("./api");
  await ingestPdf("/a.pdf", "/data/figures/s1");
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "ingest_pdf", params: { path: "/a.pdf", assets_dir: "/data/figures/s1" } });
  await pdfInfo("/a.pdf");
  expect(invoke).toHaveBeenCalledWith("sidecar_call", { method: "pdf_info", params: { path: "/a.pdf" } });
  expect(await figuresDir("s1")).toBe("/data/figures/s1");
});

it("sectionExercises collects from a section and its descendants", async () => {
  const { sectionExercises } = await import("./api");
  const ex = (id: string) => ({ id, markdown: `1. ${id}`, anchors: [{ page: 2 }] });
  const child = { id: "c", title: "Exercises", level: 3, anchors: [], children: [], exercises: [ex("e2"), { id: "", markdown: "" }] };
  const ir = { sections: [{ id: "p", title: "p", level: 2, anchors: [], children: [child], exercises: [ex("e1")] }] };
  expect(sectionExercises(ir, "p").map(e => e.id)).toEqual(["e1", "e2"]);
  expect(sectionExercises(ir, "c")[0]).toEqual({ id: "e2", markdown: "1. e2", anchors: [{ page: 2 }] });
  expect(sectionExercises(ir, "nope")).toEqual([]);
});
