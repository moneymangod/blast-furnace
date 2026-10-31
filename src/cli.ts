#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { startServer } from "./server.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Blast Furnace: one app for your Claude + ChatGPT subscriptions.

Usage: blast-furnace [--port 4545] [--no-open] [--demo]

  --demo     Use fake models (no subscription needed) to see how it works.
  --no-open  Do not open the browser.

Before the first real run:
  1. Install Claude Code and run:  claude auth login
  2. Install Codex CLI and run:    codex login   (choose "Sign in with ChatGPT")
`);
  process.exit(0);
}
if (args.includes("--demo")) process.env.BF_MOCK = "1";

const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : Number(process.env.PORT ?? 4545);
const host = process.env.HOST ?? "127.0.0.1";

if (process.env.BF_MOCK !== "1") {
  const has = (cmd: string) => {
    try {
      execFileSync(cmd, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (!has("claude")) console.warn("! Claude Code not found. Install it and run `claude auth login` to use your Claude subscription.");
  if (!has("codex")) console.warn("! Codex CLI not found. Install it (npm i -g @openai/codex) and run `codex login` to use your ChatGPT subscription.");
  if (process.env.ANTHROPIC_API_KEY) console.warn("! ANTHROPIC_API_KEY is set, so Claude will bill that key instead of your subscription.");
}

startServer({ port, host });
const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
console.log(`Blast Furnace is running at ${url}${process.env.BF_MOCK === "1" ? "  (demo mode: fake models)" : ""}`);

if (!args.includes("--no-open")) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser available */
  }
}
