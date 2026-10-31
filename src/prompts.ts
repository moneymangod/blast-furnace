// Every prompt Blast Furnace sends lives here, so you can tune the workflow in one place.
// Each system prompt starts with a ROLE line. The mock provider uses it to fake answers.

import type { Project, Task } from "./types.js";

export function ideaContext(p: Project): string {
  const parts = [`# The idea\n${p.idea}`];
  if (p.brief) parts.push(`# Agreed brief (this wins over the raw idea)\n${p.brief}`);
  else if (p.chat.length) {
    const talk = p.chat.map((m) => `${m.role === "user" ? "Owner" : "Assistant"}: ${m.text}`).join("\n\n");
    parts.push(`# Discussion with the owner\n${talk.slice(-20000)}`);
  }
  const extra = p.steps.filter((s) => p.stepOutputs[s.id]).map((s) => `## ${s.name}\n${p.stepOutputs[s.id]}`);
  if (extra.length) parts.push(`# Notes from extra steps\n${extra.join("\n\n")}`);
  parts.push(`# Workspace\nThe project folder is your working directory. It may be empty (new project) or hold existing code.`);
  return parts.join("\n\n");
}

export const SYSTEM = {
  chat: `ROLE: chat
You help the owner shape a software idea before a team of AI agents plans and builds it.
Ask sharp questions, point out gaps and risks, and suggest scope cuts. Keep answers short and plain.`,

  brief: `ROLE: brief
Turn the idea and the discussion into one clear brief that a planning team can work from.`,

  analyze: `ROLE: analyst
You are a senior engineer and product thinker. Analyze the idea deeply before anyone plans.
You may read files in the working directory but must not change anything.`,

  plan: `ROLE: planner
You are a principal engineer writing an implementation plan that other AI agents will execute.
You may read files in the working directory but must not change anything.`,

  crossReview: `ROLE: cross-reviewer
You are reviewing a plan written by another top model. Be fair and specific.`,

  merge: `ROLE: merger
You combine several plans into one final plan, keeping the best parts of each.`,

  worker: `ROLE: worker
You are an engineer on a team. Build exactly the task you are given, in the working directory.
Follow the final plan. Keep changes focused. Run the build/tests if they exist.`,

  selfReview: `ROLE: self-reviewer`,

  review: `ROLE: reviewer
You are the lead reviewer. Check a teammate's finished task. Do not change files.`,

  finalReview: `ROLE: final-reviewer
You are the lead reviewer doing the last check of the whole project. Do not change files.`,

  custom: `ROLE: custom-step`,
};

export function briefPrompt(p: Project): string {
  return `${ideaContext({ ...p, brief: undefined })}

Write the brief in Markdown with these headings: Goal, Users, Must have, Nice to have, Out of scope, Constraints, Open questions.
Only include what the owner wants or agreed to. Reply with the brief only.`;
}

export function analyzePrompt(p: Project): string {
  return `${ideaContext(p)}

Write an analysis in Markdown:
1. What is really being asked (restate in your own words).
2. Key requirements and hidden requirements.
3. Risks, unknowns, and hard parts.
4. Suggested tech approach and why. If the workspace has code, describe what is there.
5. Questions you would ask the owner (answer them yourself with sensible defaults).`;
}

export function planPrompt(p: Project, label: string): string {
  return `${ideaContext(p)}

# Your earlier analysis
${p.analyses[label] ?? "(none)"}

# Other analyses
${Object.entries(p.analyses).filter(([k]) => k !== label).map(([k, v]) => `## ${k}\n${v}`).join("\n\n") || "(none)"}

Write a complete implementation plan in Markdown:
- Architecture and tech stack, with reasons.
- File/folder layout.
- An ordered list of tasks. Each task must be small enough for one engineer agent in one sitting,
  and have a title, what to do, and clear acceptance checks.
- Testing approach.
- Risks and how the plan handles them.`;
}

export function crossReviewPrompt(p: Project, author: string): string {
  return `${ideaContext(p)}

# Plan by ${author}
${p.plans[author]}

Review this plan:
1. Strongest parts we must keep.
2. Mistakes, gaps, or risky choices, and the fix for each.
3. Anything your own plan (if you wrote one) does better.
4. Score 1-10 with one sentence why.`;
}

export function mergePrompt(p: Project): string {
  const plans = Object.entries(p.plans).map(([k, v]) => `## Plan by ${k}\n${v}`).join("\n\n");
  const reviews = Object.entries(p.crossReviews).map(([k, v]) => `## Review ${k}\n${v}`).join("\n\n");
  return `${ideaContext(p)}

# Plans
${plans}

# Cross reviews
${reviews}

Write ONE final plan that keeps the best parts of every plan and fixes the problems the reviews found.
Start with a short "What we took from each plan" section. Then the full plan in Markdown.

At the very end, add the task list as a fenced \`\`\`json block in exactly this shape:
\`\`\`json
{"tasks":[{"id":"T1","title":"...","details":"what to build, files to touch, how","acceptance":["check 1","check 2"],"dependsOn":[]}]}
\`\`\`
Tasks run one at a time in list order, each by a separate engineer agent who sees the final plan.
Make each task small and testable. Use 3 to 15 tasks.`;
}

export function workPrompt(p: Project, t: Task): string {
  return `# Final plan (for context)
${p.finalPlan}

# Your task: ${t.id} ${t.title}
${t.details}

## Acceptance checks
${t.acceptance.map((a) => `- ${a}`).join("\n")}

Do the task now. When finished, reply with a short report: what you changed, which files, and how you checked it.`;
}

export function selfReviewPrompt(t: Task): string {
  return `Now review your own work on ${t.id} like a strict reviewer would.
Check each acceptance item: ${t.acceptance.join(" | ")}.
Look for bugs, missing pieces, and broken builds or tests. Fix anything you find.
Then reply with a short self-review and end with exactly one line: VERDICT: PASS or VERDICT: FAIL`;
}

export function reviewPrompt(p: Project, t: Task, diff: string): string {
  return `# Final plan (for context)
${p.finalPlan}

# Task under review: ${t.id} ${t.title}
${t.details}

## Acceptance checks
${t.acceptance.map((a) => `- ${a}`).join("\n")}

## Worker report (${t.worker})
${t.workReport}

## Worker self-review
${t.selfReview}

## Changes
${diff || "(no git diff available: inspect the files directly)"}

Check the work against the acceptance checks and the plan. Read the files and run tests if useful, but do not edit.
If it fails, list exactly what must be fixed.
End with exactly one line: VERDICT: PASS or VERDICT: FAIL`;
}

export function fixPrompt(review: string): string {
  return `The lead reviewer sent your task back. Fix every point below, then report what you changed.

${review}`;
}

export function finalReviewPrompt(p: Project): string {
  const tasks = p.tasks.map((t) => `- ${t.id} ${t.title}: ${t.status}`).join("\n");
  return `${ideaContext(p)}

# Final plan
${p.finalPlan}

# Task results
${tasks}

Review the whole project in the working directory against the brief and final plan.
Report: what works, what is missing or broken, and the top next steps.
End with exactly one line: VERDICT: PASS or VERDICT: FAIL`;
}

export function customPrompt(p: Project, instructions: string): string {
  return `${ideaContext(p)}
${p.finalPlan ? `\n# Final plan\n${p.finalPlan}\n` : ""}
# Your job
${instructions}`;
}

/** Reads the last "VERDICT: PASS/FAIL" line. Anything unclear counts as FAIL. */
export function parseVerdict(text: string): "pass" | "fail" {
  const m = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].pop();
  return m && m[1].toUpperCase() === "PASS" ? "pass" : "fail";
}

/** Pulls the task list out of the merged plan's last ```json block. */
export function parseTasks(text: string): Task[] {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) throw new Error("The final plan has no ```json task list.");
  const raw = JSON.parse(blocks[blocks.length - 1][1]) as { tasks?: Partial<Task>[] };
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) throw new Error("The final plan's task list is empty.");
  return raw.tasks.map((t, i) => ({
    id: String(t.id ?? `T${i + 1}`),
    title: String(t.title ?? `Task ${i + 1}`),
    details: String(t.details ?? ""),
    acceptance: Array.isArray(t.acceptance) ? t.acceptance.map(String) : [],
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
    status: "todo",
    attempts: 0,
    reviews: [],
  }));
}
