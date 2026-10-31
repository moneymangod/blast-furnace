import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types.js";

/** Where Blast Furnace keeps its data. Override with BF_HOME. */
export function dataDir(): string {
  const dir = process.env.BF_HOME ?? join(homedir(), ".blast-furnace");
  mkdirSync(join(dir, "projects"), { recursive: true });
  return dir;
}

/**
 * Default team. Model ids are plain strings so you can change them when new models ship.
 * If a model id is wrong for your account, edit it in Settings.
 */
export function defaultConfig(): Config {
  return {
    roles: {
      chat: { label: "Opus 5.5", provider: "claude", model: "claude-opus-5-5", effort: "high" },
      thinkers: [
        { label: "Opus 5.5", provider: "claude", model: "claude-opus-5-5", effort: "max" },
        { label: "GPT-6 Astra", provider: "codex", model: "gpt-6-astra", effort: "xhigh" },
      ],
      merger: { label: "Opus 5.5", provider: "claude", model: "claude-opus-5-5", effort: "max" },
      workers: [
        { label: "Sonnet 5.5", provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
        { label: "GPT-6", provider: "codex", model: "gpt-6", effort: "high" },
      ],
      reviewer: { label: "GPT-6 Astra", provider: "codex", model: "gpt-6-astra", effort: "high" },
    },
    maxFixRounds: 2,
    commitEachTask: true,
    requireApproval: true,
  };
}

/** Mock team used by `npm run demo` and the tests: no subscription needed. */
export function mockConfig(): Config {
  const c = defaultConfig();
  const m = (label: string) => ({ label, provider: "mock" as const, model: "mock", effort: "low" as const });
  c.roles = {
    chat: m("Mock Opus"),
    thinkers: [m("Mock Opus"), m("Mock Astra")],
    merger: m("Mock Opus"),
    workers: [m("Mock Sonnet"), m("Mock GPT")],
    reviewer: m("Mock Astra"),
  };
  return c;
}

export function loadConfig(): Config {
  if (process.env.BF_MOCK === "1") return mockConfig();
  const file = join(dataDir(), "config.json");
  if (!existsSync(file)) {
    const c = defaultConfig();
    writeFileSync(file, JSON.stringify(c, null, 2));
    return c;
  }
  return { ...defaultConfig(), ...JSON.parse(readFileSync(file, "utf8")) };
}

export function saveConfig(c: Config): void {
  if (process.env.BF_MOCK === "1") return;
  writeFileSync(join(dataDir(), "config.json"), JSON.stringify(c, null, 2));
}
