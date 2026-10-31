import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { RunOptions, RunResult } from "./index.js";

/**
 * Fake provider for demos and tests. It answers instantly with canned text so you
 * can watch the whole pipeline run without spending any subscription usage.
 * Set BF_MOCK_FAIL_FIRST_REVIEW=1 to make the first task review fail once.
 */
let reviewCount = 0;

export async function runMock(opts: RunOptions): Promise<RunResult> {
  if (opts.signal?.aborted) throw new Error("aborted");
  await new Promise((r) => setTimeout(r, Number(process.env.BF_MOCK_DELAY ?? 30)));
  const role = /ROLE:\s*([\w-]+)/.exec(opts.system ?? "")?.[1] ?? "unknown";
  const who = opts.spec.label;
  const sessionId = opts.sessionId ?? `mock-${Math.random().toString(36).slice(2, 10)}`;
  const say = (text: string): RunResult => ({ text, sessionId });

  switch (role) {
    case "chat":
      return say(`(${who}) Good idea. Who is it for, and what is the one thing it must do on day one?`);
    case "brief":
      return say(`## Goal\nA tiny demo app.\n\n## Must have\n- A greeting file\n\n## Out of scope\n- Everything else`);
    case "analyst":
      return say(`## Analysis by ${who}\nThe idea is small. Main risk: scope creep.`);
    case "planner":
      return say(`## Plan by ${who}\n1. Create hello.txt\n2. Create README.md`);
    case "cross-reviewer":
      return say(`Keep step 1. Step 2 needs acceptance checks. Score 8/10.`);
    case "merger":
      return say(
        `## What we took from each plan\nBoth plans agreed.\n\n## Final plan\nTwo small tasks.\n\n` +
          "```json\n" +
          JSON.stringify({
            tasks: [
              { id: "T1", title: "Create hello.txt", details: "Write hello.txt", acceptance: ["hello.txt exists"], dependsOn: [] },
              { id: "T2", title: "Create README.md", details: "Write README.md", acceptance: ["README.md exists"], dependsOn: ["T1"] },
            ],
          }) +
          "\n```",
      );
    case "worker": {
      if (opts.write) appendFileSync(join(opts.cwd, "mock-output.txt"), `${who} worked: ${opts.prompt.split("\n")[0].slice(0, 80)}\n`);
      if (opts.prompt.includes("VERDICT")) return say(`Checked my work. Looks right.\nVERDICT: PASS`);
      return say(`Done. Wrote mock-output.txt.`);
    }
    case "reviewer": {
      reviewCount++;
      if (process.env.BF_MOCK_FAIL_FIRST_REVIEW === "1" && reviewCount === 1) return say(`Missing a newline at the end.\nVERDICT: FAIL`);
      return say(`Looks good.\nVERDICT: PASS`);
    }
    case "final-reviewer":
      return say(`Everything in the plan is done.\nVERDICT: PASS`);
    default:
      return say(`(${who}) done.`);
  }
}
