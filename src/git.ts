import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

/** Identity flags so commits work even when the user never set git user.name. */
function who(cwd: string): string[] {
  const name = tryGit(cwd, ["config", "user.name"])?.trim();
  return name ? [] : ["-c", "user.name=Blast Furnace", "-c", "user.email=blast-furnace@localhost"];
}

/** Make sure the workspace is a git repo with at least one commit, so each task gets a checkpoint. */
export function ensureRepo(cwd: string): boolean {
  if (tryGit(cwd, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") {
    if (tryGit(cwd, ["init", "-q"]) === undefined) return false;
  }
  if (tryGit(cwd, ["rev-parse", "HEAD"]) === undefined) {
    tryGit(cwd, [...who(cwd), "commit", "-q", "--allow-empty", "-m", "Blast Furnace: start"]);
  }
  return true;
}

/** Everything changed since the last commit (new files included), cut to a size a reviewer can read. */
export function diffSinceHead(cwd: string, max = 60000): string {
  if (tryGit(cwd, ["add", "-A"]) === undefined) return "";
  const stat = tryGit(cwd, ["diff", "--cached", "--stat"]) ?? "";
  const diff = tryGit(cwd, ["diff", "--cached"]) ?? "";
  const body = diff.length > max ? `${diff.slice(0, max)}\n... (diff cut, ${diff.length - max} more characters)` : diff;
  return stat ? `${stat}\n${body}` : "";
}

export function commitAll(cwd: string, message: string): boolean {
  if (tryGit(cwd, ["add", "-A"]) === undefined) return false;
  if (!tryGit(cwd, ["status", "--porcelain"])?.trim()) return false;
  return tryGit(cwd, [...who(cwd), "commit", "-q", "-m", message]) !== undefined;
}
