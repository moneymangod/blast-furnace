import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "./config.js";
import type { LogEntry, Project } from "./types.js";

/** Saves each project as one JSON file and tells listeners when it changes. */
export class Store extends EventEmitter {
  private cache = new Map<string, Project>();

  private file(id: string) {
    return join(dataDir(), "projects", `${id}.json`);
  }

  list(): Project[] {
    const dir = join(dataDir(), "projects");
    const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    return ids.map((id) => this.get(id)!).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Project | undefined {
    if (!/^[\w-]+$/.test(id)) return undefined;
    if (this.cache.has(id)) return this.cache.get(id);
    if (!existsSync(this.file(id))) return undefined;
    const p = JSON.parse(readFileSync(this.file(id), "utf8")) as Project;
    // A project that was running when the app closed is not running anymore.
    if (p.status === "running") p.status = "stopped";
    this.cache.set(id, p);
    return p;
  }

  create(input: { name: string; workspace: string; idea: string }): Project {
    const p: Project = {
      id: randomUUID().slice(0, 8),
      name: input.name,
      workspace: input.workspace,
      idea: input.idea,
      createdAt: new Date().toISOString(),
      status: "draft",
      chat: [],
      analyses: {},
      plans: {},
      crossReviews: {},
      tasks: [],
      steps: [],
      stepOutputs: {},
      completed: [],
      log: [],
    };
    this.save(p);
    return p;
  }

  /** Change a project and save it. */
  update(id: string, fn: (p: Project) => void): Project {
    const p = this.get(id);
    if (!p) throw new Error(`No project ${id}`);
    fn(p);
    this.save(p);
    return p;
  }

  log(id: string, text: string, level: LogEntry["level"] = "info", who?: string): void {
    this.update(id, (p) => {
      p.log.push({ at: new Date().toISOString(), level, who, text });
      if (p.log.length > 2000) p.log.splice(0, p.log.length - 2000);
    });
  }

  private save(p: Project) {
    this.cache.set(p.id, p);
    const tmp = `${this.file(p.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(p, null, 2));
    renameSync(tmp, this.file(p.id));
    this.emit("change", p.id);
  }
}
