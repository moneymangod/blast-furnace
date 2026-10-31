import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BF_MOCK = "1";
process.env.BF_MOCK_DELAY = "1";
process.env.BF_MOCK_FAIL_FIRST_REVIEW = "1";
process.env.BF_HOME = mkdtempSync(join(tmpdir(), "bf-home-"));

const { Store } = await import("../src/store.js");
const { Pipeline } = await import("../src/pipeline.js");
const { parseTasks, parseVerdict } = await import("../src/prompts.js");

async function waitFor(fn: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("parses verdicts and task lists", () => {
  assert.equal(parseVerdict("ok\nVERDICT: PASS"), "pass");
  assert.equal(parseVerdict("VERDICT: PASS\nlater... VERDICT: FAIL"), "fail");
  assert.equal(parseVerdict("no verdict"), "fail");
  const tasks = parseTasks('plan\n```json\n{"tasks":[{"title":"A","acceptance":["x"]}]}\n```');
  assert.equal(tasks[0].id, "T1");
  assert.deepEqual(tasks[0].acceptance, ["x"]);
  assert.throws(() => parseTasks("no json"));
});

test("full pipeline: discuss, brief, plan, cross review, merge, approve, build with reviews, custom steps", async () => {
  const store = new Store();
  const pipe = new Pipeline(store);
  const ws = mkdtempSync(join(tmpdir(), "bf-ws-"));
  const p = store.create({ name: "Demo", workspace: ws, idea: "Make a greeting app" });

  await pipe.chat(p.id, "It is for my kids.");
  assert.equal(store.get(p.id)!.chat.length, 2);
  await pipe.refine(p.id);
  assert.match(store.get(p.id)!.brief!, /Goal/);

  store.update(p.id, (p) => {
    p.steps = [
      { id: "research", name: "Research", when: "before", stage: "analyze", role: "thinkers", access: "read", prompt: "Research similar apps" },
      { id: "docs", name: "Docs", when: "after", stage: "execute", role: "workers", access: "write", prompt: "Write docs" },
    ];
  });

  pipe.start(p.id);
  await waitFor(() => store.get(p.id)!.status === "waiting");
  let cur = store.get(p.id)!;
  assert.deepEqual(Object.keys(cur.analyses).sort(), ["Mock Astra", "Mock Opus"]);
  assert.equal(Object.keys(cur.plans).length, 2);
  assert.deepEqual(Object.keys(cur.crossReviews).sort(), ["Mock Astra -> Mock Opus", "Mock Opus -> Mock Astra"]);
  assert.equal(cur.tasks.length, 2);
  assert.match(cur.stepOutputs.research, /Mock Opus/);
  assert.ok(!cur.completed.includes("execute"), "must wait for approval before building");

  await waitFor(() => !pipe.isRunning(p.id));
  pipe.approve(p.id);
  await waitFor(() => !pipe.isRunning(p.id) && store.get(p.id)!.status !== "running");
  cur = store.get(p.id)!;
  assert.equal(cur.status, "done", cur.error);

  const [t1, t2] = cur.tasks;
  assert.equal(t1.status, "done");
  assert.equal(t1.worker, "Mock Sonnet");
  assert.equal(t2.worker, "Mock GPT");
  // First review failed, worker fixed, second review passed.
  assert.deepEqual(t1.reviews.map((r) => r.verdict), ["fail", "pass"]);
  assert.equal(t1.attempts, 1);
  assert.match(t1.selfReview!, /VERDICT: PASS/);
  assert.ok(cur.stepOutputs.docs);
  assert.match(cur.finalReview!, /PASS/);

  // Workers really wrote files, and each passed task got a git commit.
  assert.ok(existsSync(join(ws, "mock-output.txt")));
  assert.ok(readFileSync(join(ws, "mock-output.txt"), "utf8").includes("Mock Sonnet"));
  const log = execFileSync("git", ["log", "--oneline"], { cwd: ws, encoding: "utf8" });
  assert.match(log, /T1: Create hello.txt/);
  assert.match(log, /T2: Create README.md/);
});

test("stop and reset", async () => {
  process.env.BF_MOCK_DELAY = "50";
  const store = new Store();
  const pipe = new Pipeline(store);
  const p = store.create({ name: "Stop me", workspace: mkdtempSync(join(tmpdir(), "bf-ws-")), idea: "x" });
  pipe.start(p.id);
  await new Promise((r) => setTimeout(r, 20));
  pipe.stop(p.id);
  await waitFor(() => !pipe.isRunning(p.id));
  assert.equal(store.get(p.id)!.status, "stopped");

  process.env.BF_MOCK_DELAY = "1";
  pipe.start(p.id);
  await waitFor(() => store.get(p.id)!.status === "waiting");
  await waitFor(() => !pipe.isRunning(p.id));
  pipe.resetFrom(p.id, "plan");
  const cur = store.get(p.id)!;
  assert.deepEqual(cur.completed, ["analyze"]);
  assert.equal(cur.finalPlan, undefined);
  assert.equal(Object.keys(cur.analyses).length, 2);
});
