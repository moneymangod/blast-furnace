import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import type { RunOptions, RunResult } from "./index.js";

let codex: Codex | undefined;

/**
 * Runs OpenAI models through the official Codex SDK, which drives your local
 * Codex CLI. Log in once with `codex login` (pick "Sign in with ChatGPT") and
 * your ChatGPT subscription is used.
 */
export async function runCodex(opts: RunOptions): Promise<RunResult> {
  codex ??= new Codex();
  const threadOpts: ThreadOptions = {
    model: opts.spec.model,
    modelReasoningEffort: opts.spec.effort,
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    sandboxMode: opts.write ? "workspace-write" : "read-only",
    approvalPolicy: "never",
  };
  const thread = opts.sessionId ? codex.resumeThread(opts.sessionId, threadOpts) : codex.startThread(threadOpts);

  // Codex has no separate system prompt, so the role instructions go first.
  const input = opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const { events } = await thread.runStreamed(input, { signal: opts.signal });

  let text = "";
  for await (const ev of events) {
    if (ev.type === "item.completed") {
      const item = ev.item;
      if (item.type === "agent_message") text = item.text;
      else if (item.type === "command_execution") opts.onProgress?.(`ran: ${item.command.slice(0, 120)}`);
      else if (item.type === "file_change") opts.onProgress?.(`edited: ${item.changes.map((c) => c.path).join(", ")}`);
    } else if (ev.type === "turn.failed") {
      throw new Error(`Codex (${opts.spec.label}) failed: ${ev.error.message}`);
    } else if (ev.type === "error") {
      throw new Error(`Codex (${opts.spec.label}) error: ${ev.message}`);
    }
  }
  return { text, sessionId: thread.id ?? opts.sessionId };
}
