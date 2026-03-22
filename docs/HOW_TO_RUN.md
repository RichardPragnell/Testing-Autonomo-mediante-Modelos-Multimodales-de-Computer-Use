# How To Run

This document is the operational runbook for the repository: install it, start the local benchmark app, execute a benchmark suite, inspect results, and run a self-heal attempt.

## 1. Prerequisites

- Node.js 22 or newer
- `pnpm` via `npx pnpm@9.12.3`
- At least one model provider API key for real Stagehand runs:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`

Important:
- Stagehand runs locally in this repo. The browser is local and the AUT is local.
- Browserbase cloud is not used.
- If you only want to validate the repo wiring, `build` and `test` do not require real model calls.

## 2. Install

From the repository root:

```bash
Copy-Item .env.example .env
```

Then fill the variables you need in `.env`.

After that:

```bash
npx pnpm@9.12.3 install
npx pnpm@9.12.3 build
npx pnpm@9.12.3 test
```

## 3. Start The Benchmark App Directly

The benchmark target is `apps/todo-react`. You can run its pristine template directly without the harness:

```bash
npx pnpm@9.12.3 app:todo-react
```

Open:

```text
http://127.0.0.1:3101
```

What this gives you:
- The clean app template from `apps/todo-react/template`
- No benchmark cloning yet
- No bug packs applied yet

Use this when you want to inspect the baseline app manually.

## 4. List What Can Be Run

List available benchmark targets:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list targets
```

List available suites:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list suites
```

Describe the current target:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench describe target --target todo-react
```

## 5. Run A Benchmark Suite

Committed benchmark suites:

- `experiments/suites/todo-react-guided-clean.json`
- `experiments/suites/todo-react-autonomous-clean.json`
- `experiments/suites/todo-react-guided-bugged.json`
- `experiments/suites/todo-react-autonomous-bugged.json`

Run the guided suite:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/todo-react-guided-bugged.json
```

Run the autonomous suite:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/todo-react-autonomous-bugged.json
```

What happens during `bench run`:
1. The harness loads the suite from `experiments/suites`.
2. It loads the target manifest from `apps/todo-react/target.json`.
3. It clones the pristine app into `results/runs/<runId>/workspace`.
4. It applies the selected bug packs into that cloned workspace.
5. It starts the cloned AUT locally.
6. It runs the selected scenarios with the configured models.
7. It writes artifacts and reports under `results/`.

The command prints JSON with:
- `runId`
- `artifactPath`
- `reportPath`

Keep the `runId`. You need it for reporting, comparison, and self-heal.

## 6. Inspect The Results

Read the report for a run:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench report --run-id <runId>
```

Important generated paths:
- `results/runs/<runId>/run.json`: full run artifact
- `results/runs/<runId>/manifest.json`: compact run manifest
- `results/runs/<runId>/workspace`: cloned app used in that run
- `results/runs/<runId>/artifacts/...`: screenshots, DOM snapshots, traces
- `results/reports/<runId>.json`: summary report

The full run artifact contains:
- selected target, bug ids, scenario ids, and exploration mode
- per-model task results
- findings
- `sourceCandidates` ranked to point to likely files in the cloned workspace

## 7. Compare Guided vs Autonomous

After running both suites, compare them:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench compare --run-ids <guidedRunId> <autonomousRunId>
```

Use this to compare:
- pass rate
- score
- stability
- cost
- failure clustering

## 8. Run Self-Heal

Self-heal works from a specific finding inside a specific run.

First, get a run report:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench report --run-id <runId>
```

Then inspect `results/runs/<runId>/run.json` and choose a `findingId`.

Run repair:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal --run-id <runId> --finding-id <findingId> --agent-command "<your-agent-command>"
```

Important contract for `--agent-command`:
- It receives a JSON context object on `stdin`
- It must print a valid unified diff to `stdout`
- The patch is applied in an isolated worktree rooted in the cloned run workspace

That means:
- the pristine target under `apps/todo-react/template` is not modified
- the repair attempt is isolated to the benchmark run workspace

## 9. Run The MCP Server

Start the benchmark MCP server over stdio:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-mcp start
```

Available tools:
- `bench.run_suite`
- `bench.get_report`
- `bench.compare_runs`
- `bench.run_self_heal`
- `bench.list_targets`
- `bench.list_suites`
- `bench.describe_target`

See also:
- `docs/STAGEHAND_MCP_SETUP.md`

## 10. Model Registry

The default model registry is:

```text
experiments/models/registry.yaml
```

If you want to run a custom registry:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/todo-react-guided-bugged.json --models-path path/to/registry.yaml
```

## 11. Common Local Workflow

Minimal practical loop:

1. Export one provider API key.
2. Run `bench list suites`.
3. Run the guided suite.
4. Open `results/runs/<runId>/run.json`.
5. Inspect findings and their `sourceCandidates`.
6. Trigger `bench heal` for one finding.
7. Re-run the suite or compare against a baseline run.

## 12. Troubleshooting

If `bench run` starts but does not execute model calls:
- verify that at least one enabled model has its required API key set

If the AUT does not start:
- verify that port `3101` is free
- verify that the cloned workspace exists under `results/runs/<runId>/workspace`

If self-heal says no patch was generated:
- your agent command did not print a valid unified diff

If you want more runtime details for local Stagehand:
- read `docs/STAGEHAND_MCP_SETUP.md`
