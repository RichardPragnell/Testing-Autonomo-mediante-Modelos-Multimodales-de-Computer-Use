# How To Run

This document is the operational runbook for the repository: install it, start the local benchmark app, run the three experiment families, inspect results, and repair a finding.

## 1. Prerequisites

- Node.js 22 or newer
- `pnpm` installed locally or via Corepack
- `OPENROUTER_API_KEY` for real benchmark runs

The repo pins `pnpm@9.12.3` in the root `package.json`, but the examples below use plain `pnpm`.

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
pnpm install
pnpm build
pnpm test
```

## 3. Start The Benchmark App

The benchmark target is `apps/todo-react`. You can run its pristine template directly without the harness:

```bash
pnpm app:todo-react
```

Open `http://127.0.0.1:3101`.

This gives you the clean app template from `apps/todo-react/template`, with no benchmark clone and no bug packs applied.

## 4. Benchmark Manifest

The canonical benchmark behavior now lives at `specs/todo-web/contract.json`.

For `todo-react`, `apps/todo-react/benchmark.json` binds that contract into the harness and defines:

- guided QA capabilities and task ids
- exploration coverage targets and heuristic thresholds
- heal cases, reproduction tasks, validation commands, and regression tasks

Use the manifest instead of spreading benchmark definitions across separate suite files.

## 5. Run QA

QA measures how well a model follows the guided scenarios and reaches the expected outcomes.

```bash
pnpm bench qa todo-react
```

QA reports compare:

- capability pass rate
- full-scenario completion rate
- trial stability
- latency
- cost

## 6. Run Exploration

Exploration measures whether the model discovers useful app functionality before it is asked to validate anything.

```bash
pnpm bench explore todo-react
```

Exploration reports compare:

- discovered capability coverage
- probe replay pass rate
- states discovered
- transitions discovered
- action diversity

## 7. Run Self-Heal

Self-heal measures how well a model can diagnose, patch, and validate seeded bugs.

```bash
pnpm bench heal todo-react
```

Heal reports compare:

- localization accuracy
- patch apply rate
- validation success
- failing-task fix rate
- regression-free rate

## 8. Results Layout

Generated outputs are written under:

- `results/qa/runs/<runId>` plus `results/qa/reports/<runId>.json|.html`
- `results/explore/runs/<runId>` plus `results/explore/reports/<runId>.json|.html`
- `results/heal/runs/<runId>` plus `results/heal/reports/<runId>.json|.html`

Each run should produce:

- a full JSON artifact
- a compact JSON summary report
- a static HTML dashboard with comparative charts

## 9. Reading Results

The CLI prints:

- `runId`
- `artifactPath`
- `reportPath`
- `htmlPath`

Use those output paths directly. The CLI no longer provides separate `report` or `compare` commands.

## 10. Common Local Workflow

Minimal practical loop:

1. Export `OPENROUTER_API_KEY`.
2. Run `bench qa todo-react`.
3. Run `bench explore todo-react`.
4. Run `bench heal todo-react`.
5. Open the JSON and HTML reports under `results/<experiment>/reports`.
6. Compare runs by opening the generated report files directly.

## 11. Troubleshooting

If a run starts but does not execute model calls:
- verify that `OPENROUTER_API_KEY` is set

If the AUT does not start:
- verify that port `3101` is free
- verify that the cloned workspace exists under the run directory

If self-heal cannot produce a patch:
- verify that the repair model returned a structured diagnosis and a unified diff

If you want more runtime details for local Stagehand:
- read `docs/STAGEHAND_MCP_SETUP.md`
