# Blast Furnace: the full plan

## 1. What we are building

One app that uses **both** your Claude subscription and your ChatGPT (Codex) subscription, like
[T3 Code](https://github.com/pingdotgg/t3code) does, and runs every project through a fixed team workflow:

```
 You                    Big models (Opus 5.5 + GPT-6 Astra)                Small models (Sonnet 5.5 + GPT-6)
 ───                    ───────────────────────────────────                ─────────────────────────────────
 1. Send idea
 2. Discuss  ──────►  (chat model asks questions)
 3. Brief    ──────►  (chat model writes the agreed brief)
       [your extra "before" steps]
                      4. Analyze      each big model studies the idea      (in parallel)
                      5. Plan         each big model writes a full plan    (in parallel)
                      6. Cross review each reviews the other's plan        (in parallel)
                      7. Merge        best parts -> ONE final plan + task list
 8. Approve  ◄──────  (pipeline pauses until you press Approve)
                                                                          9. For each task:
                                                                             a. worker builds it
                                                                             b. worker self-reviews and fixes
                      c. big reviewer checks the diff  ◄────────────────────
                         FAIL -> back to the worker with notes (up to N rounds)
                         PASS -> git commit checkpoint
                      10. Final review of the whole project
       [your extra "after" steps]
```

Source of the idea: Theo (t3.gg) runs a $200 Claude plan and a $200 ChatGPT plan side by side in T3 Code,
using GPT for most coding and Claude for UI and polish passes
(video: "I need you guys to trust me on this (sorry Anthropic)", March 2026). Blast Furnace takes that
"use both subscriptions in one place" idea and adds a structured plan, review, and build pipeline on top.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Use subscriptions, not API keys | Claude via the official **Claude Agent SDK** (drives your local Claude Code login). OpenAI via the official **Codex SDK** (drives your local `codex login` with ChatGPT). | Same approach T3 Code uses. No header spoofing, no OAuth hacks, uses the plans you already pay for. |
| Fork T3 Code or not | **Standalone app** for v0.1, MIT licensed, credits T3 Code. | T3 Code is a large Effect-based codebase built around single chat threads, and says it is not taking outside contributions yet. Our core is a multi-agent pipeline, which is new code either way. A small codebase is easier to change. Section 8 covers porting it into a T3 Code fork later. |
| Pipeline as data | Built-in stages + **custom steps** you attach before/after any stage. | You asked for "anything else I need to do afterwards or beforehand." |
| Models as config | Every role (chat, thinkers, merger, workers, reviewer) is a list in `~/.blast-furnace/config.json`. | New models ship monthly. Swap ids without code changes. |
| Safety | Planners and reviewers are **read-only**. Only workers (and custom steps marked "write") change files. Every passed task is a git commit. | Bad work is easy to see and roll back. |
| Human gate | Pipeline **pauses after the final plan** until you approve. | You stay in charge of what gets built. |
| No build step for UI | Plain HTML/JS/CSS served by a tiny Node server. | Fewer moving parts for v0.1. |

## 3. Roles and default models

| Role | Default | Provider | Effort | Access |
|---|---|---|---|---|
| Chat (discuss + brief) | Opus 5.5 `claude-opus-5-5` | claude | high | read |
| Thinkers (analyze, plan, cross review) | Opus 5.5 + GPT-6 Astra `gpt-6-astra` | claude + codex | max / xhigh | read |
| Merger | Opus 5.5 | claude | max | read |
| Workers (round-robin) | Sonnet 5.5 `claude-sonnet-5-5` + GPT-6 `gpt-6` | claude + codex | high | write |
| Reviewer (per task + final) | GPT-6 Astra | codex | high | read |

The reviewer is on the *other* provider from the merger on purpose, so the final plan gets checked by a
different model family. Change any of this in **Settings**. If an OpenAI model id is different on your
account, put the right id there.

## 4. Architecture

```
web/  (index.html, app.js, style.css)      browser UI, live updates over Server-Sent Events
  │  HTTP + SSE
src/server.ts                               tiny JSON API, no framework
src/pipeline.ts                             the workflow engine (stages, custom steps, task loop)
src/prompts.ts                              every prompt in one file + parsers (task JSON, VERDICT)
src/providers/claude.ts                     Claude Agent SDK  -> local Claude Code -> Claude subscription
src/providers/codex.ts                      Codex SDK         -> local Codex CLI   -> ChatGPT subscription
src/providers/mock.ts                       fake models for demo + tests
src/store.ts                                one JSON file per project in ~/.blast-furnace/projects
src/git.ts                                  diff for reviewers, commit per passed task
src/cli.ts                                  `blast-furnace` command: checks logins, starts server, opens browser
```

### Data per project
Idea, chat, brief, analyses (per model), plans (per model), cross reviews (per pair), final plan,
tasks (status, worker, report, self-review, all reviews), custom steps + outputs, completed stages, log.

### How resuming works
Each stage and custom step is recorded in `completed` when it finishes. **Continue** skips finished
work. **Redo from: X** clears stage X and everything after it. Stopping mid-task puts the task back to
"todo"; the worker's conversation id is kept so it can pick up where it left off.

### Task loop details
1. Worker gets the final plan + its task + acceptance checks. It edits files and runs tests.
2. Same worker, same conversation, is asked to review itself strictly and fix what it finds. Ends with `VERDICT`.
3. Reviewer gets the plan, task, worker report, self-review, and the **git diff**, can read files and run tests but not edit. Ends with `VERDICT: PASS/FAIL`.
4. FAIL: the review goes back to the worker (same conversation) to fix, then steps 2-3 repeat. After `maxFixRounds` (default 2) the task is marked failed and anything depending on it is skipped.
5. PASS: commit `T3: title` with who built and who reviewed it.

## 5. API

| Method | Path | Does |
|---|---|---|
| GET | `/api/config` | current team + stage list |
| PUT | `/api/config` | save team |
| GET/POST | `/api/projects` | list / create (idea, name, folder) |
| GET | `/api/projects/:id` | full project |
| GET | `/api/projects/:id/events` | live updates (SSE) |
| POST | `/api/projects/:id/chat` | discuss the idea |
| POST | `/api/projects/:id/refine` | write the brief from the chat |
| POST | `/api/projects/:id/edit` | edit idea / brief / final plan / name |
| POST | `/api/projects/:id/steps` | save custom steps |
| POST | `/api/projects/:id/start` · `approve` · `stop` · `reset` | run control |

## 6. Build phases

| Phase | What | Status |
|---|---|---|
| 0 | Repo, license, plan | done |
| 1 | Providers (Claude, Codex, mock) | done |
| 2 | Pipeline engine: stages, custom steps, approval gate, task loop, git checkpoints, stop/continue/redo | done |
| 3 | Web UI: projects, idea + chat + brief, plans view, build view, steps editor, log, settings | done |
| 4 | Tests: full pipeline with mock models (incl. failed review then fix), stop + reset | done |
| 5 | First real run with your subscriptions; tune prompts and model ids | next (needs your machine) |
| 6 | Parallel workers in separate git worktrees for independent tasks | later |
| 7 | Markdown rendering, diff viewer, cost/usage meter per stage | later |
| 8 | Optional: port the pipeline into a T3 Code fork as a "Furnace" mode | later |

## 7. Risks

| Risk | Plan |
|---|---|
| Subscription rate limits on long runs | Stop/Continue keeps all progress; effort per role is configurable; use fewer thinkers for small ideas. |
| Provider terms change (Anthropic and OpenAI have both changed what third-party tools may do) | We only use the official SDKs that drive your own logged-in CLIs, the same route T3 Code uses. |
| Merger returns a bad task list | Parser retries once in the same conversation; you can edit the final plan before approving. |
| Workers break each other's code | Tasks run one at a time, each ends in a commit; reviewer sees the exact diff. |
| Model ids change | All ids live in Settings. |

## 8. Later: T3 Code fork path
If you want this inside T3 Code itself: fork `pingdotgg/t3code` (MIT, keep its license notice), add a
"Furnace" project type whose server side calls `src/pipeline.ts` (it only needs a `runAgent` function,
which T3 Code's provider layer already has the pieces for), and show stages/tasks in T3 Code's sidebar.
