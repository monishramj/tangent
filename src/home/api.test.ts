import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ingestPdf, listSections, sectionText } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("r") }));

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
