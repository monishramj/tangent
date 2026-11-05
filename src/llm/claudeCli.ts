/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "./provider";

export type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

// Keep in sync with src-tauri/src/llm.rs (build_args, CLAUDE_DENIED_TOOLS, CLAUDE_ENV).
// Prompts carry untrusted text: no tools, no MCP, no user/project settings or hooks, no slash commands, no saved session.
export const CLAUDE_DENIED_TOOLS = "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task";
export const CLAUDE_BASE_ARGS = [
  "-p", "--model", "haiku",
  "--tools", "", "--disallowedTools", CLAUDE_DENIED_TOOLS,
  "--strict-mcp-config", "--setting-sources", "",
  "--disable-slash-commands", "--no-session-persistence",
];
export const CLAUDE_ENV = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };

export function claudeArgs(system?: string, withImages = false, model: "haiku" | "sonnet" = "haiku"): string[] {
  const args = [...CLAUDE_BASE_ARGS.map(a => a === "haiku" ? model : a), ...(withImages
    ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
    : ["--output-format", "text"])];
  if (system !== undefined) args.push("--system-prompt", system);
  return args;
}

/** One stream-json user message: images first, then the text prompt. */
export const streamInput = (prompt: string, images: string[]) => JSON.stringify({
  type: "user",
  message: { role: "user", content: [
    ...images.map(data => ({ type: "image", source: { type: "base64", media_type: "image/png", data } })),
    { type: "text", text: prompt },
  ] },
}) + "\n";

/** Text of the final `result` event in stream-json output. */
export function parseStreamResult(stdout: string): string {
  const ev = stdout.split("\n").reverse().map(l => { try { return JSON.parse(l); } catch { return null; } })
    .find(v => v?.type === "result");
  if (!ev) throw new Error("Claude CLI: no result event");
  if (ev.is_error || (ev.subtype && ev.subtype !== "success")) throw new Error(`Claude CLI: ${ev.result || ev.subtype}`);
  return String(ev.result ?? "");
}

/** Node-side batch provider; keep child_process out of the webview bundle. Runs in a fresh empty temp dir. */
export class ClaudeCodeCLI implements LLMProvider {
  constructor(private readonly spawnProcess: Spawn = spawn) {}

  complete(prompt: string, opts: Parameters<LLMProvider["complete"]>[1] = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new Error("Claude CLI aborted"));
      const images = opts.images ?? [];
      const cwd = mkdtempSync(join(tmpdir(), "tangent-llm-"));
      const child = this.spawnProcess("claude", claudeArgs(opts.system, images.length > 0, opts.model),
        { stdio: "pipe", cwd, env: { ...process.env, ...CLAUDE_ENV } });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", abort);
        try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
        if (error) return reject(error);
        try { resolve(images.length ? parseStreamResult(stdout) : stdout); } catch (e) { reject(e as Error); }
      };
      const stop = (message: string) => {
        finish(new Error(message));
        child.kill("SIGKILL");
      };
      const abort = () => stop("Claude CLI aborted");
      const timer = setTimeout(() => stop("Claude CLI timeout"), opts.timeoutMs ?? 120_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.once("error", finish);
      child.stdin.once("error", error => {
        finish(error);
        child.kill("SIGKILL");
      });
      child.once("close", (code, signal) => finish(code === 0 ? undefined :
        new Error(`Claude CLI exited (${code ?? signal}): ${stderr.trim()}`)));
      opts.signal?.addEventListener("abort", abort, { once: true });
      if (opts.signal?.aborted) abort();
      else child.stdin.end(images.length ? streamInput(prompt, images) : prompt);
    });
  }
}
