// Shared types for Blast Furnace.

export type ProviderId = "claude" | "codex" | "mock";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One model a role can use, e.g. Opus 5.5 through the Claude subscription. */
export interface ModelSpec {
  /** Short display name, e.g. "Opus 5.5". Must be unique inside a role list. */
  label: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
}

/** Which models do which job. Edited in the Settings tab or ~/.blast-furnace/config.json. */
export interface Roles {
  /** Talks with you about the idea before the pipeline starts. */
  chat: ModelSpec;
  /** The big models: each analyzes the idea, writes a plan, and reviews the other plans. */
  thinkers: ModelSpec[];
  /** Merges the plans and reviews into one final plan. */
  merger: ModelSpec;
  /** Smaller models that build the tasks. Tasks are handed out round-robin. */
  workers: ModelSpec[];
  /** Big model that reviews every finished task after the worker's self-review. */
  reviewer: ModelSpec;
}

export interface Config {
  roles: Roles;
  /** How many times a task may be sent back for fixes before it is marked failed. */
  maxFixRounds: number;
  /** Commit to git after each task passes review (only if the workspace is a git repo). */
  commitEachTask: boolean;
  /** Stop after the final plan and wait for you to press Approve. */
  requireApproval: boolean;
}

/** The built-in stages, in order. Custom steps hook in before or after any of them. */
export const STAGES = ["analyze", "plan", "crossReview", "merge", "approve", "execute", "finalReview"] as const;
export type StageId = (typeof STAGES)[number];

export type StepRole = "chat" | "merger" | "reviewer" | "thinkers" | "workers";

/** A step you add yourself, e.g. "research competitors" before analyze or "write docs" after execute. */
export interface CustomStep {
  id: string;
  name: string;
  when: "before" | "after";
  stage: StageId;
  role: StepRole;
  /** "read" = may only look at files. "write" = may change files. */
  access: "read" | "write";
  prompt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export type TaskStatus = "todo" | "working" | "self-review" | "review" | "fixing" | "done" | "failed";

export interface Task {
  id: string;
  title: string;
  details: string;
  acceptance: string[];
  dependsOn: string[];
  status: TaskStatus;
  worker?: string;
  workerSession?: string;
  attempts: number;
  workReport?: string;
  selfReview?: string;
  reviews: { by: string; verdict: "pass" | "fail"; text: string }[];
}

export interface LogEntry {
  at: string;
  level: "info" | "warn" | "error";
  who?: string;
  text: string;
}

export type ProjectStatus = "draft" | "running" | "waiting" | "done" | "failed" | "stopped";

export interface Project {
  id: string;
  name: string;
  /** Folder the agents work in. */
  workspace: string;
  idea: string;
  /** Clear, agreed brief written after the discussion. The pipeline uses this if present. */
  brief?: string;
  createdAt: string;
  status: ProjectStatus;
  /** Stage currently running, or the last one reached. */
  stage?: string;
  chat: ChatMessage[];
  chatSession?: string;
  /** keyed by model label */
  analyses: Record<string, string>;
  plans: Record<string, string>;
  /** keyed by "Reviewer -> Author" */
  crossReviews: Record<string, string>;
  finalPlan?: string;
  tasks: Task[];
  finalReview?: string;
  steps: CustomStep[];
  /** Output of custom steps, keyed by step id. */
  stepOutputs: Record<string, string>;
  /** Built-in stages already finished, so a re-run can pick up where it stopped. */
  completed: string[];
  log: LogEntry[];
  error?: string;
}
