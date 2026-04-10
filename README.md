# Agentic QA Orchestrator

Benchmark-first monorepo for local web QA with LLM-driven exploration and self-healing.

The benchmark surface is intentionally narrow:

- `pnpm guided`: guided scenario execution against clean app clones
- `pnpm explore`: autonomous exploration and coverage discovery
- `pnpm heal`: diagnosis and repair of seeded defects
- `pnpm fullbench`: guided, explore, and heal across all apps, then final report rebuild
- `pnpm report`: rebuild mode and benchmark comparison reports from saved benchmark report JSON files

## Repository Layout

- `apps/`: benchmark applications kept as pristine templates plus reproducible bug packs
- `packages/`: reusable harness, CLI, and MCP code
- `experiments/`: model registry, prompts, and benchmark definitions
- `results/`: generated workspaces, JSON reports, HTML dashboards, and sample fixtures
- `specs/`: framework-agnostic benchmark contracts

The current reference implementation is `apps/todo-react`.
The framework-agnostic source of truth is `specs/todo-web/contract.json`; each app-level `benchmark.json` binds that shared contract into the harness.

## Cost Tracking

Benchmark runs use OpenRouter for real model execution and exact cost accounting.

- Set `OPENROUTER_API_KEY` to enable guided, exploration, and self-heal model calls
- `OPENROUTER_BASE_URL` is optional and defaults to OpenRouter's hosted endpoint
- Generated reports include cost visualizations and audit tables for each experiment family

## Quick Start

```bash
Copy-Item .env.example .env
pnpm install
pnpm build
pnpm test
```

Run the pristine reference app directly:

```bash
pnpm app:todo-react
```

Open `http://127.0.0.1:3101`.

## Benchmark Commands

Guided:

```bash
pnpm guided todo-angular
pnpm guided
pnpm guided --parallelism 2 --app-parallelism 2
```

Autonomous exploration:

```bash
pnpm explore todo-react
pnpm explore
pnpm explore --parallelism 2 --app-parallelism 2
```

Self-heal:

```bash
pnpm heal todo-nextjs
pnpm heal
pnpm heal --parallelism 2 --app-parallelism 2
```

Report rebuild:

```bash
pnpm report
pnpm report guided
pnpm report explore
pnpm report heal
pnpm report --html-scope all
```

Full benchmark:

```bash
pnpm fullbench
pnpm fullbench --parallel 2 --app-parallelism 2
pnpm fullbench --parallelism 2 --html-scope all
```

While a run is active the CLI streams progress logs to the terminal, and the final JSON summary remains on stdout. `pnpm report` prints the latest-per-app-mode-model selection it used plus the rebuilt report paths. `pnpm fullbench` runs all three modes sequentially and finishes by rebuilding the benchmark-wide comparison outputs.

`--parallelism` controls per-app model concurrency. When you omit the app and run across the full benchmark set, `--app-parallelism` controls how many apps run at once. Each parallel execution still gets its own freshly copied template workspace and reserved AUT port.

For `pnpm fullbench`, `--parallel <n>` is a direct alias for `--parallelism <n>`.

## Full Benchmark

Typical clean end-to-end run:

```powershell
Remove-Item -Recurse -Force results\guided, results\explore, results\heal, results\compare -ErrorAction SilentlyContinue
pnpm fullbench --parallel 2 --app-parallelism 2
```

This runs all enabled models across all discoverable apps for guided, exploration, and self-heal, then rebuilds the final benchmark comparison report under `results/compare` as `benchmark-compare-latest.html|json`.

It also emits `benchmark-compare-standardized-latest.html|json`, a table-first benchmark report organized by mode and then by app.

Rendered HTML reports are now written in formal Spanish. Persisted JSON report artifacts and schema keys remain in English for compatibility.

## Documentation

- `README.md`: project overview and command map
- `docs/HOW_TO_RUN.md`: installation, run workflows, result inspection, and rebuild usage
- `docs/STAGEHAND_MCP_SETUP.md`: Stagehand-local runtime details
- `specs/todo-web/README.md`: shared todo benchmark contract rules

## Notes

- Local configuration template: `.env.example`
- The CLI and benchmark app server auto-load `.env` from the repository root when present
- Omitting the app for `pnpm guided`, `pnpm explore`, or `pnpm heal` runs that mode across all discoverable benchmark apps and writes one aggregate comparison report
- `pnpm fullbench` runs `guided`, `explore`, and `heal` sequentially across all discoverable benchmark apps, then rebuilds the benchmark comparison outputs
- `pnpm report` rebuilds comparison pages from `results/<mode>/reports/*.json`, using the latest available report per `mode+app+model`, and writes stable latest outputs under `results/compare`
- `pnpm report --html-scope all` also regenerates saved per-run HTML under `results/<mode>/reports` in addition to comparison pages under `results/compare`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
