# 🔥 Blast Furnace

**One app for your Claude and ChatGPT subscriptions, with a full plan, review, and build team.**

You type an idea. Two top models (Opus 5.5 and GPT-6 Astra) each analyze it and write a plan, review
each other's plans, and merge the best parts into one final plan. You approve it. Then smaller models
(Sonnet 5.5 and GPT-6) build it task by task. Each one checks its own work, then a big model reviews it
before it is saved as a git commit.

Inspired by Theo's (t3.gg) setup of running both subscriptions in [T3 Code](https://github.com/pingdotgg/t3code).

## Quick start

```bash
# 1. Log in to both subscriptions once
npm i -g @anthropic-ai/claude-code @openai/codex
claude auth login        # your Claude plan
codex login              # choose "Sign in with ChatGPT"

# 2. Run Blast Furnace
git clone https://github.com/moneymangod/blast-furnace
cd blast-furnace
npm install
npm run dev              # opens http://127.0.0.1:4545
```

Want to see it work first without using your plans? `npm run demo` uses fake models.

> Keep `ANTHROPIC_API_KEY` unset, or Claude bills that key instead of your subscription.

## How to use it

1. **+ New project**: type your idea and pick a folder for the code.
2. **Idea tab**: chat about it, then press **Write brief**. Edit the brief if you like.
3. **Steps tab** (optional): add your own steps before or after any stage, e.g. "before Analyze: research competitors".
4. **Start**. Watch Analyze, Plan, Cross review, Merge in the **Plans** tab.
5. **Approve plan** when you are happy (you can edit it first).
6. Watch the **Build** tab: every task shows the worker's report, its self-review, and the big model's review.
7. Use **Stop**, **Continue**, and **Redo from** any time. Nothing is lost.

## Change the team

**Settings** holds the models for each role. `provider: "claude"` uses your Claude plan, `"codex"`
uses your ChatGPT plan. Change model ids, effort, or add more thinkers/workers there.

## Docs

- [The full plan](docs/PLAN.md): workflow, architecture, decisions, roadmap.

## Develop

```bash
npm test          # full pipeline test with fake models
npm run typecheck
npm run build     # compiles to dist/, then `npm start`
```

MIT license.
