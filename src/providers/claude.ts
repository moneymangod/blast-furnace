import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunOptions, RunResult } from "./index.js";

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];

/**
 * Runs Claude through the official Claude Agent SDK, which drives your local
 * Claude Code install. Log in once with `claude auth login` and your Claude
 * subscription is used. (If ANTHROPIC_API_KEY is set, Claude Code bills that key
 * instead, so leave it unset to use the subscription.)
 */
export async function runClaude(opts: RunOptions): Promise<RunResult> {
  const abortController = new AbortController();
  opts.signal?.addEventListener("abort", () => abortController.abort(), { once: true });

  const stream = query({
    prompt: opts.prompt,
    options: {
      model: opts.spec.model,
      effort: opts.spec.effort,
      cwd: opts.cwd,
      resume: opts.sessionId,
      abortController,
      systemPrompt: { type: "preset", preset: "claude_code", append: opts.system },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      disallowedTools: opts.write ? [] : WRITE_TOOLS,
    },
  });

  let sessionId = opts.sessionId;
  let text = "";
  for await (const msg of stream) {
    if ("session_id" in msg && typeof msg.session_id === "string") sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") opts.onProgress?.(`${block.name} ${shortInput(block.input)}`);
      }
    } else if (msg.type === "result") {
      if (msg.subtype !== "success" || msg.is_error) {
        throw new Error(`Claude (${opts.spec.label}) failed: ${"result" in msg ? msg.result : msg.subtype}`);
      }
      text = msg.result;
    }
  }
  return { text, sessionId };
}

function shortInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const v = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url ?? "";
  return String(v).slice(0, 120);
}
