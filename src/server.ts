import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig } from "./config.js";
import { Pipeline } from "./pipeline.js";
import { Store } from "./store.js";
import { STAGES, type Config, type CustomStep, type StageId } from "./types.js";

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");

export function startServer(opts: { port: number; host: string }) {
  const store = new Store();
  const pipeline = new Pipeline(store);

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, store, pipeline);
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });
  server.listen(opts.port, opts.host);
  return { server, store, pipeline };
}

async function route(req: IncomingMessage, res: ServerResponse, store: Store, pipeline: Pipeline) {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const m = req.method ?? "GET";

  if (parts[0] !== "api") return serveStatic(url.pathname, res);

  // /api/config
  if (parts[1] === "config") {
    if (m === "GET") return send(res, 200, { config: loadConfig(), stages: STAGES, mock: process.env.BF_MOCK === "1" });
    if (m === "PUT") {
      const c = (await body(req)) as Config;
      saveConfig(c);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] !== "projects") return send(res, 404, { error: "Not found" });

  // /api/projects
  if (parts.length === 2) {
    if (m === "GET") return send(res, 200, store.list().map(({ id, name, status, stage, createdAt }) => ({ id, name, status, stage, createdAt })));
    if (m === "POST") {
      const b = (await body(req)) as { name?: string; workspace?: string; idea?: string };
      if (!b.idea?.trim()) throw new Error("Type your idea first.");
      if (!b.workspace?.trim()) throw new Error("Pick a project folder.");
      const p = store.create({ name: b.name?.trim() || b.idea.trim().slice(0, 40), workspace: resolve(b.workspace.trim()), idea: b.idea.trim() });
      return send(res, 200, p);
    }
  }

  const id = parts[2];
  const p = store.get(id);
  if (!p) return send(res, 404, { error: "No such project" });
  const action = parts[3];

  if (!action && m === "GET") return send(res, 200, { ...p, running: pipeline.isRunning(id) });

  // Live updates (Server-Sent Events).
  if (action === "events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    let timer: NodeJS.Timeout | undefined;
    const push = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        res.write(`data: ${JSON.stringify({ ...store.get(id), running: pipeline.isRunning(id) })}\n\n`);
      }, 150);
    };
    const onChange = (changed: string) => changed === id && push();
    store.on("change", onChange);
    push();
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      store.off("change", onChange);
      clearInterval(ping);
      if (timer) clearTimeout(timer);
    });
    return;
  }

  if (m !== "POST") return send(res, 405, { error: "Use POST" });
  const b = (await body(req)) as Record<string, unknown>;

  switch (action) {
    case "chat":
      if (!String(b.message ?? "").trim()) throw new Error("Empty message.");
      // Reply right away; the answer arrives over the live updates.
      pipeline.chat(id, String(b.message)).catch((e) => store.log(id, `Chat failed: ${e.message}`, "error"));
      return send(res, 200, { ok: true });
    case "refine":
      pipeline.refine(id).catch((e) => store.log(id, `Brief failed: ${e.message}`, "error"));
      return send(res, 200, { ok: true });
    case "edit": {
      store.update(id, (p) => {
        if (typeof b.idea === "string") p.idea = b.idea;
        if (typeof b.brief === "string") p.brief = b.brief || undefined;
        if (typeof b.name === "string" && b.name.trim()) p.name = b.name.trim();
        if (typeof b.finalPlan === "string" && p.finalPlan !== undefined) p.finalPlan = b.finalPlan;
      });
      return send(res, 200, { ok: true });
    }
    case "steps": {
      const steps = (b.steps as CustomStep[]).map((s) => ({
        id: s.id || randomUUID().slice(0, 8),
        name: String(s.name || "Custom step"),
        when: s.when === "before" ? "before" : "after",
        stage: (STAGES as readonly string[]).includes(s.stage) ? s.stage : "execute",
        role: s.role,
        access: s.access === "write" ? "write" : "read",
        prompt: String(s.prompt ?? ""),
      })) as CustomStep[];
      store.update(id, (p) => (p.steps = steps));
      return send(res, 200, { ok: true });
    }
    case "start":
      pipeline.start(id);
      return send(res, 200, { ok: true });
    case "approve":
      pipeline.approve(id);
      return send(res, 200, { ok: true });
    case "stop":
      pipeline.stop(id);
      return send(res, 200, { ok: true });
    case "reset":
      pipeline.resetFrom(id, b.stage as StageId);
      return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "Unknown action" });
}

function serveStatic(path: string, res: ServerResponse) {
  const file = path === "/" ? "index.html" : path.slice(1);
  const full = resolve(WEB_DIR, file);
  if (!full.startsWith(WEB_DIR) || !existsSync(full)) return send(res, 404, { error: "Not found" });
  const type = full.endsWith(".js") ? "text/javascript" : full.endsWith(".css") ? "text/css" : "text/html";
  res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
  res.end(readFileSync(full));
}

function send(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}


