import type { ModelSpec } from "../types.js";
import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runMock } from "./mock.js";

export interface RunOptions {
  spec: ModelSpec;
  prompt: string;
  /** Extra instructions for the agent's role. */
  system?: string;
  /** Folder the agent works in. */
  cwd: string;
  /** true = agent may edit files and run commands. false = look only. */
  write: boolean;
  /** Continue an earlier conversation with the same agent. */
  sessionId?: string;
  signal?: AbortSignal;
  /** Short live updates for the log ("reading src/app.ts", "running npm test"). */
  onProgress?: (text: string) => void;
}

export interface RunResult {
  text: string;
  sessionId?: string;
}

/** Run one agent turn on whichever subscription the model belongs to. */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  switch (opts.spec.provider) {
    case "claude":
      return runClaude(opts);
    case "codex":
      return runCodex(opts);
    case "mock":
      return runMock(opts);
    default:
      throw new Error(`Unknown provider: ${(opts.spec as ModelSpec).provider}`);
  }
}
