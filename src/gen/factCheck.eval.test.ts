// @vitest-environment node
// Measures the fact-check false-flag rate. Skipped unless TANGENT_FACTCHECK_EVAL is set (it calls `claude -p` haiku,
// one call per fixture). Step 12 stays OFF by default until this prints a rate <= 5% on a realistic set.
//
//   TANGENT_FACTCHECK_EVAL=1 npx vitest run src/gen/factCheck.eval
//   TANGENT_FACTCHECK_FIXTURES=/path/outside/repo.json ...   # your own recorded beats (same shape; keeps book text out of git)
//
// Fixture shape: { name, expected: "supported"|"unsupported"|"wrong-anchor", rightAnchor?, sources: [{id, markdown}], beat: {say, visualIntent, passages} }
import { it } from "vitest";
import { readFileSync } from "node:fs";
import { ClaudeCodeCLI } from "../llm/claudeCli";
import { checkBeats, falseFlagRate, type Verdict } from "./factCheck";
import type { Beat } from "./script";
import bundled from "./factCheck.fixtures.json";

type Fixture = { name: string; expected: string; rightAnchor?: string; sources: { id: string; markdown: string }[]; beat: Beat };

it.skipIf(!process.env.TANGENT_FACTCHECK_EVAL)("false-flag rate on recorded beats", async () => {
  const path = process.env.TANGENT_FACTCHECK_FIXTURES;
  const fixtures: Fixture[] = path ? JSON.parse(readFileSync(path, "utf8")) : bundled;
  const provider = new ClaudeCodeCLI();
  const rows: { name: string; expected: string; got: Verdict; anchor?: string }[] = [];
  for (const f of fixtures) {
    const [r] = await checkBeats([f.beat], f.sources, provider);
    rows.push({ name: f.name, expected: f.expected, got: r.verdict, anchor: r.anchor });
  }
  console.table(rows);
  const correct = rows.filter(r => r.expected === "supported").length;
  const missed = rows.filter(r => r.expected === "unsupported" && r.got !== "unsupported").map(r => r.name);
  const wrongAnchor = fixtures.filter(f => f.expected === "wrong-anchor");
  const anchorsFixed = wrongAnchor.filter(f => rows.find(r => r.name === f.name)?.anchor === f.rightAnchor).length;
  console.log(`FALSE-FLAG RATE: ${(falseFlagRate(rows) * 100).toFixed(1)}% of ${correct} correct beats (turn the flag on only if <= 5%)`);
  console.log(`missed unsupported: ${missed.join(", ") || "none"}; wrong anchors corrected: ${anchorsFixed}/${wrongAnchor.length}`);
}, 600_000);
