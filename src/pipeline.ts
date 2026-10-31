// The workflow engine: analyze -> plan -> cross review -> merge -> approve -> execute -> final review,
// with your own custom steps before or after any stage.

import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { commitAll, diffSinceHead, ensureRepo } from "./git.js";
import * as P from "./prompts.js";
import { runAgent, type RunOptions } from "./providers/index.js";
import type { Store } from "./store.js";
import { STAGES, type Config, type CustomStep, type ModelSpec, type Project, type StageId, type Task } from "./types.js";

class Stopped extends Error {}

export class Pipeline {
  private running = new Map<string, AbortController>();

  constructor(private store: Store) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  stop(id: string): void {
    this.running.get(id)?.abort();
  }

  /** Talk about the idea before (or between) runs. */
  async chat(id: string, message: string): Promise<void> {
    if (this.isRunning(id)) throw new Error("Wait for the run to finish or stop it first.");
    const cfg = loadConfig();
    const p = this.store.update(id, (p) => p.chat.push({ role: "user", text: message, at: now() }));
    const first = p.chat.length === 1;
    const prompt = first ? `${P.ideaContext(p)}\n\n# Owner says\n${message}` : message;
    const res = await this.call(id, cfg.roles.chat, { prompt, system: P.SYSTEM.chat, write: false, sessionId: p.chatSession });
    this.store.update(id, (p) => {
      p.chat.push({ role: "assistant", text: res.text, at: now() });
      p.chatSession = res.sessionId;
    });
  }

  /** Turn idea + discussion into a clear brief the planners will use. */
  async refine(id: string): Promise<void> {
    if (this.isRunning(id)) throw new Error("Wait for the run to finish or stop it first.");
    const cfg = loadConfig();
    const p = this.store.get(id)!;
    const res = await this.call(id, cfg.roles.chat, { prompt: P.briefPrompt(p), system: P.SYSTEM.brief, write: false });
    this.store.update(id, (p) => (p.brief = res.text));
  }

  /** Start or continue the pipeline. Finished stages are skipped. */
  start(id: string): void {
    if (this.isRunning(id)) throw new Error("Already running.");
    const ac = new AbortController();
    this.running.set(id, ac);
    this.store.update(id, (p) => {
      p.status = "running";
      p.error = undefined;
    });
    this.run(id, ac.signal)
      .catch((err) => {
        const stopped = err instanceof Stopped || ac.signal.aborted;
        this.store.update(id, (p) => {
          p.status = stopped ? "stopped" : "failed";
          if (!stopped) p.error = String(err?.message ?? err);
          for (const t of p.tasks) if (!["todo", "done", "failed"].includes(t.status)) t.status = "todo";
        });
        this.store.log(id, stopped ? "Stopped." : `Failed: ${err?.message ?? err}`, stopped ? "warn" : "error");
      })
      .finally(() => this.running.delete(id));
  }

  /** Press "Approve" on the final plan. */
  approve(id: string): void {
    this.store.update(id, (p) => {
      if (!p.completed.includes("merge")) throw new Error("There is no final plan yet.");
      if (!p.completed.includes("approve")) p.completed.push("approve");
    });
    this.store.log(id, "Final plan approved by owner.");
    this.start(id);
  }

  /** Clear a stage (and everything after it) so the next run redoes it. */
  resetFrom(id: string, stage: StageId): void {
    if (this.isRunning(id)) throw new Error("Stop the run first.");
    const from = STAGES.indexOf(stage);
    const redo = new Set<string>(STAGES.slice(from));
    this.store.update(id, (p) => {
      p.steps.filter((s) => STAGES.indexOf(s.stage) >= from).forEach((s) => redo.add(`step:${s.id}`));
      p.completed = p.completed.filter((c) => !redo.has(c));
      if (from <= STAGES.indexOf("analyze")) p.analyses = {};
      if (from <= STAGES.indexOf("plan")) p.plans = {};
      if (from <= STAGES.indexOf("crossReview")) p.crossReviews = {};
      if (from <= STAGES.indexOf("merge")) (p.finalPlan = undefined), (p.tasks = []);
      if (from === STAGES.indexOf("execute")) p.tasks.forEach((t) => Object.assign(t, { status: "todo", attempts: 0, reviews: [], workerSession: undefined }));
      if (from <= STAGES.indexOf("finalReview")) p.finalReview = undefined;
      p.status = "draft";
    });
  }

  // ---------------------------------------------------------------- the run

  private async run(id: string, signal: AbortSignal): Promise<void> {
    const cfg = loadConfig();
    const p0 = this.store.get(id)!;
    mkdirSync(p0.workspace, { recursive: true });

    for (const stage of STAGES) {
      await this.customSteps(id, cfg, "before", stage, signal);
      if (!this.store.get(id)!.completed.includes(stage)) {
        this.store.update(id, (p) => (p.stage = stage));
        this.store.log(id, `Stage: ${stage}`);
        const done = await this.runStage(id, cfg, stage, signal);
        if (!done) return; // waiting for the owner
        this.store.update(id, (p) => p.completed.push(stage));
      }
      await this.customSteps(id, cfg, "after", stage, signal);
    }
    const p = this.store.get(id)!;
    const failed = p.tasks.filter((t) => t.status === "failed").length;
    this.store.update(id, (p) => (p.status = failed ? "failed" : "done"));
    this.store.log(id, failed ? `Finished with ${failed} failed task(s).` : "All done.", failed ? "warn" : "info");
  }

  /** Returns false when the pipeline must pause for the owner. */
  private async runStage(id: string, cfg: Config, stage: StageId, signal: AbortSignal): Promise<boolean> {
    const { roles } = cfg;
    switch (stage) {
      case "analyze": {
        // All thinkers at once.
        await Promise.all(
          roles.thinkers.map(async (spec) => {
            const p = this.store.get(id)!;
            if (p.analyses[spec.label]) return;
            const r = await this.call(id, spec, { prompt: P.analyzePrompt(p), system: P.SYSTEM.analyze, write: false, signal });
            this.store.update(id, (p) => (p.analyses[spec.label] = r.text));
          }),
        );
        return true;
      }
      case "plan": {
        await Promise.all(
          roles.thinkers.map(async (spec) => {
            const p = this.store.get(id)!;
            if (p.plans[spec.label]) return;
            const r = await this.call(id, spec, { prompt: P.planPrompt(p, spec.label), system: P.SYSTEM.plan, write: false, signal });
            this.store.update(id, (p) => (p.plans[spec.label] = r.text));
          }),
        );
        return true;
      }
      case "crossReview": {
        // Every thinker reviews every other thinker's plan.
        const pairs: [ModelSpec, string][] = [];
        for (const reviewer of roles.thinkers)
          for (const author of Object.keys(this.store.get(id)!.plans)) if (author !== reviewer.label) pairs.push([reviewer, author]);
        if (pairs.length === 0) {
          // Only one thinker: it reviews its own plan so the merge still gets a critique.
          for (const author of Object.keys(this.store.get(id)!.plans)) pairs.push([roles.thinkers[0], author]);
        }
        await Promise.all(
          pairs.map(async ([reviewer, author]) => {
            const key = `${reviewer.label} -> ${author}`;
            const p = this.store.get(id)!;
            if (p.crossReviews[key]) return;
            const r = await this.call(id, reviewer, { prompt: P.crossReviewPrompt(p, author), system: P.SYSTEM.crossReview, write: false, signal });
            this.store.update(id, (p) => (p.crossReviews[key] = r.text));
          }),
        );
        return true;
      }
      case "merge": {
        const p = this.store.get(id)!;
        let r = await this.call(id, roles.merger, { prompt: P.mergePrompt(p), system: P.SYSTEM.merge, write: false, signal });
        let tasks: Task[];
        try {
          tasks = P.parseTasks(r.text);
        } catch (e) {
          // One retry asking only for the JSON.
          this.store.log(id, `Task list unreadable (${(e as Error).message}). Asking again.`, "warn");
          const fix = await this.call(id, roles.merger, {
            prompt: "Your reply must end with the ```json task list described earlier. Reply again with the full final plan and the JSON block.",
            system: P.SYSTEM.merge, write: false, sessionId: r.sessionId, signal,
          });
          r = fix;
          tasks = P.parseTasks(r.text);
        }
        this.store.update(id, (p) => {
          p.finalPlan = r.text;
          p.tasks = tasks;
        });
        this.store.log(id, `Final plan ready with ${tasks.length} tasks.`);
        return true;
      }
      case "approve": {
        if (!cfg.requireApproval) return true;
        this.store.update(id, (p) => (p.status = "waiting"));
        this.store.log(id, "Waiting for you to approve the final plan.");
        return false;
      }
      case "execute":
        await this.execute(id, cfg, signal);
        return true;
      case "finalReview": {
        const p = this.store.get(id)!;
        const r = await this.call(id, roles.reviewer, { prompt: P.finalReviewPrompt(p), system: P.SYSTEM.finalReview, write: false, signal });
        this.store.update(id, (p) => (p.finalReview = r.text));
        return true;
      }
    }
  }

  private async execute(id: string, cfg: Config, signal: AbortSignal): Promise<void> {
    const ws = this.store.get(id)!.workspace;
    const useGit = cfg.commitEachTask && ensureRepo(ws);
    const { workers, reviewer } = cfg.roles;
    const tasks = this.store.get(id)!.tasks;

    for (let i = 0; i < tasks.length; i++) {
      const taskId = tasks[i].id;
      const t0 = this.task(id, taskId);
      if (t0.status === "done" || t0.status === "failed") continue;

      const blockedBy = t0.dependsOn.filter((d) => this.store.get(id)!.tasks.find((t) => t.id === d)?.status === "failed");
      if (blockedBy.length) {
        this.setTask(id, taskId, { status: "failed", workReport: `Skipped: depends on failed ${blockedBy.join(", ")}` });
        continue;
      }

      const worker = workers.find((w) => w.label === t0.worker) ?? workers[i % workers.length];
      this.setTask(id, taskId, { worker: worker.label, status: "working" });
      this.store.log(id, `${taskId} "${t0.title}" -> ${worker.label}`);

      // 1. Build.
      let r = await this.call(id, worker, {
        prompt: P.workPrompt(this.store.get(id)!, this.task(id, taskId)),
        system: P.SYSTEM.worker, write: true, sessionId: t0.workerSession, signal,
      });
      this.setTask(id, taskId, { workReport: r.text, workerSession: r.sessionId });

      for (;;) {
        // 2. Self-review (same agent, same conversation, may fix things).
        this.setTask(id, taskId, { status: "self-review" });
        const self = await this.call(id, worker, {
          prompt: P.selfReviewPrompt(this.task(id, taskId)), system: P.SYSTEM.worker, write: true,
          sessionId: this.task(id, taskId).workerSession, signal,
        });
        this.setTask(id, taskId, { selfReview: self.text, workerSession: self.sessionId ?? this.task(id, taskId).workerSession });

        // 3. Big model reviews.
        this.setTask(id, taskId, { status: "review" });
        const diff = useGit ? diffSinceHead(ws) : "";
        const rev = await this.call(id, reviewer, {
          prompt: P.reviewPrompt(this.store.get(id)!, this.task(id, taskId), diff), system: P.SYSTEM.review, write: false, signal,
        });
        const verdict = P.parseVerdict(rev.text);
        this.store.update(id, (p) => p.tasks.find((t) => t.id === taskId)!.reviews.push({ by: reviewer.label, verdict, text: rev.text }));
        this.store.log(id, `${taskId} review by ${reviewer.label}: ${verdict.toUpperCase()}`, verdict === "pass" ? "info" : "warn");

        if (verdict === "pass") {
          this.setTask(id, taskId, { status: "done" });
          if (useGit) commitAll(ws, `${taskId}: ${t0.title}\n\nBuilt by ${worker.label}, reviewed by ${reviewer.label} (Blast Furnace)`);
          break;
        }
        const attempts = this.task(id, taskId).attempts + 1;
        this.setTask(id, taskId, { attempts });
        if (attempts > cfg.maxFixRounds) {
          this.setTask(id, taskId, { status: "failed" });
          this.store.log(id, `${taskId} failed after ${cfg.maxFixRounds} fix round(s).`, "error");
          break;
        }
        // 4. Send it back to the worker with the review.
        this.setTask(id, taskId, { status: "fixing" });
        r = await this.call(id, worker, {
          prompt: P.fixPrompt(rev.text), system: P.SYSTEM.worker, write: true, sessionId: this.task(id, taskId).workerSession, signal,
        });
        this.setTask(id, taskId, { workReport: r.text, workerSession: r.sessionId ?? this.task(id, taskId).workerSession });
      }
    }
  }

  private async customSteps(id: string, cfg: Config, when: "before" | "after", stage: StageId, signal: AbortSignal) {
    const steps = this.store.get(id)!.steps.filter((s) => s.when === when && s.stage === stage);
    for (const step of steps) {
      const key = `step:${step.id}`;
      if (this.store.get(id)!.completed.includes(key)) continue;
      this.store.update(id, (p) => (p.stage = step.name));
      this.store.log(id, `Custom step: ${step.name}`);
      const specs = this.specsFor(cfg, step);
      const outs = await Promise.all(
        specs.map((spec) =>
          this.call(id, spec, { prompt: P.customPrompt(this.store.get(id)!, step.prompt), system: P.SYSTEM.custom, write: step.access === "write", signal }),
        ),
      );
      const text = outs.length === 1 ? outs[0].text : outs.map((o, i) => `### ${specs[i].label}\n${o.text}`).join("\n\n");
      this.store.update(id, (p) => {
        p.stepOutputs[step.id] = text;
        p.completed.push(key);
      });
    }
  }

  private specsFor(cfg: Config, step: CustomStep): ModelSpec[] {
    const r = cfg.roles;
    if (step.role === "thinkers") return r.thinkers;
    if (step.role === "workers") return [r.workers[0]];
    return [r[step.role]];
  }

  // ---------------------------------------------------------------- helpers

  private async call(id: string, spec: ModelSpec, o: Omit<RunOptions, "spec" | "cwd" | "onProgress">) {
    if (o.signal?.aborted) throw new Stopped();
    const p = this.store.get(id)!;
    this.store.log(id, `${spec.label} is working...`, "info", spec.label);
    try {
      return await runAgent({ ...o, spec, cwd: p.workspace, onProgress: (t) => this.store.log(id, t, "info", spec.label) });
    } catch (e) {
      if (o.signal?.aborted) throw new Stopped();
      throw e;
    }
  }

  private task(id: string, taskId: string): Task {
    return this.store.get(id)!.tasks.find((t) => t.id === taskId)!;
  }

  private setTask(id: string, taskId: string, patch: Partial<Task>) {
    this.store.update(id, (p) => Object.assign(p.tasks.find((t) => t.id === taskId)!, patch));
  }
}

function now() {
  return new Date().toISOString();
}
