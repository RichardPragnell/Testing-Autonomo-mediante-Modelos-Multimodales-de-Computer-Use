# How To Run

This document is the operational runbook for the repository: install it, start the local benchmark app, run the experiment families, inspect results, and repair a finding.

The preferred root commands are `corepack pnpm guided`, `corepack pnpm explore`, `corepack pnpm heal`, `corepack pnpm fullbench`, and `corepack pnpm report`.

## 1. Prerequisites

- Node.js 22 or newer
- `pnpm` installed locally or via Corepack
- `OPENROUTER_API_KEY` for real benchmark runs

The repo pins `pnpm@9.12.3` in the root `package.json`; the safest cross-machine form is `corepack pnpm`.

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
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

## 3. Start A Benchmark App

The repo ships benchmark apps for React, Next.js, and Angular. You can run a pristine template directly without the harness:

```bash
corepack pnpm app:todo-react
corepack pnpm app:todo-nextjs
corepack pnpm app:todo-angular
```

These serve on:

- React: `http://127.0.0.1:3101`
- Next.js: `http://127.0.0.1:3102`
- Angular: `http://127.0.0.1:3103`

This gives you the clean app template from `apps/todo-react/template`, with no benchmark clone and no bug packs applied.

## 4. Benchmark Manifest

The canonical benchmark behavior now lives at `specs/todo-web/contract.json`.

For `todo-react`, `apps/todo-react/benchmark.json` binds that contract into the harness and defines:

- guided capabilities and scenario ids
- exploration coverage targets and heuristic thresholds
- heal cases, reproduction scenarios, validation commands, and regression scenarios

Use the manifest instead of spreading benchmark definitions across separate suite files.

## 5. Run Guided

Guided runs measure how well a model follows the guided scenarios and reaches the expected outcomes.

```bash
corepack pnpm guided todo-react
corepack pnpm guided todo-react --parallelism 2
corepack pnpm guided --parallelism 2 --app-parallelism 2
```

Guided reports compare:

- capability pass rate
- full-scenario completion rate
- trial stability
- run latency
- cost

## 6. Run Exploration

Exploration measures whether the model discovers useful app functionality before it is asked to validate anything.

```bash
corepack pnpm explore todo-react
corepack pnpm explore todo-react --parallelism 2
corepack pnpm explore --parallelism 2 --app-parallelism 2
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
corepack pnpm heal todo-react
corepack pnpm heal todo-react --parallelism 2
corepack pnpm heal --parallelism 2 --app-parallelism 2
```

Heal reports compare:

- fix rate
- localization accuracy
- patch apply rate
- validation success
- failing-scenario fix rate
- regression-free rate

`patch apply rate` remains visible in the report tables and audits, but it no longer contributes to the weighted self-heal score.

## 8. Run Full Benchmark

`fullbench` is the top-level sequential run for the whole benchmark surface. It runs guided, then exploration, then self-heal, and finally rebuilds the benchmark-wide reports.

```bash
corepack pnpm fullbench
corepack pnpm fullbench --parallel 2 --app-parallelism 2
corepack pnpm fullbench --parallelism 2 --html-scope all
```

Notes:

- `--parallel <n>` is an alias for `--parallelism <n>`
- `--parallelism` controls per-app model concurrency within each phase
- `--app-parallelism` controls multi-app concurrency within each phase
- `--html-scope all` rebuilds saved per-run HTML as well as comparison pages at the end of the sequence

## 9. Results Layout

Generated outputs are written under:

- `results/guided/runs/<runId>` plus `results/guided/reports/<runId>.json|.html`
- `results/explore/runs/<runId>` plus `results/explore/reports/<runId>.json|.html`
- `results/heal/runs/<runId>` plus `results/heal/reports/<runId>.json|.html`
- `results/compare/<compareId>.json|.html` for rebuilt mode and benchmark comparison reports

Each run should produce:

- a full JSON artifact
- a compact JSON summary report
- a static HTML dashboard with comparative charts

HTML reports are rendered in formal Spanish. JSON report artifacts and schema keys remain in English for compatibility with downstream tooling.

## 10. Reading Results

The CLI prints:

- live progress logs to the terminal while the run is active
- `runId`
- `artifactPath`
- `reportPath`
- `htmlPath`

Use those output paths directly. The live progress logs are for humans; the final JSON summary remains the machine-readable output.

Parallelism notes:
- `--parallelism` runs multiple models at once inside a single app run
- `--app-parallelism` applies when you omit the app and run across all benchmark apps
- every parallel worker still prepares its own clean workspace clone from the app template
- AUT ports are reserved per worker to avoid collisions during parallel startup

To rebuild comparison pages from existing benchmark report JSON files:

```bash
corepack pnpm report
corepack pnpm report guided
corepack pnpm report explore
corepack pnpm report heal
corepack pnpm report --html-scope all
```

`report` uses the `latest-per-app-mode-model` selection policy:

- it scans `results/<mode>/reports/*.json`
- it picks the newest saved report per `mode+appId+modelId`
- it rebuilds the requested mode comparison pages
- with no mode argument, it also rebuilds one benchmark mega report across the available modes

`--html-scope` controls how much HTML is regenerated:

- `compare` rebuilds comparison pages under `results/compare`
- `all` rebuilds comparison pages and also regenerates saved per-run HTML from existing report JSON under `results/<mode>/reports`

Rebuilt outputs are written under `results/compare` as stable latest files such as `guided-compare-latest.json|html` and `benchmark-compare-latest.json|html`.

For the benchmark-wide rebuild with no mode argument, the repo now also writes:

- `benchmark-compare-standardized-latest.html|json`

This additional report is table-first: it standardizes model results by mode and then compares model performance per app.

## 11. Common Local Workflow

Minimal practical loop:

1. Export `OPENROUTER_API_KEY`.
2. Run `corepack pnpm fullbench --parallel 2 --app-parallelism 2`.
3. If you need to regenerate all saved HTML from JSON, run `corepack pnpm report --html-scope all`.
4. Open the JSON and HTML reports under `results/<experiment>/reports` and `results/compare`.

Manual per-mode loop when you do not want the full sequence:

1. Run `corepack pnpm guided todo-react`.
2. Run `corepack pnpm explore todo-react`.
3. Run `corepack pnpm heal todo-react`.
4. Run `corepack pnpm report`.

## 12. Troubleshooting

If a run starts but does not execute model calls:
- verify that `OPENROUTER_API_KEY` is set

If the AUT does not start:
- verify that port `3101` is free
- verify that the cloned workspace exists under the run directory

If self-heal cannot produce a patch:
- verify that the repair model returned a structured diagnosis and a unified diff

If you want more runtime details for local Stagehand:
- read `docs/STAGEHAND_MCP_SETUP.md`
