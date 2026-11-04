/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import type { LLMProvider } from "./provider";

export type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Node-side batch provider; keep child_process out of the webview bundle. */
export class ClaudeCodeCLI implements LLMProvider {
  constructor(private readonly spawnProcess: Spawn = spawn) {}

  complete(prompt: string, opts: Parameters<LLMProvider["complete"]>[1] = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new Error("Claude CLI aborted"));
      const args = ["-p", "--output-format", "text", "--model", "haiku"];
      if (opts.system !== undefined) args.push("--system-prompt", opts.system);
      const child = this.spawnProcess("claude", args, { stdio: "pipe" });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(stdout);
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
      else child.stdin.end(prompt);
    });
  }
}
