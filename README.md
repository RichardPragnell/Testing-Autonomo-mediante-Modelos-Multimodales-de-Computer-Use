# Agentic QA Orchestrator

Benchmark-first monorepo for local web QA with LLM-driven exploration and self-healing.

The benchmark surface is intentionally narrow:

- `pnpm qa`: guided scenario execution against clean app clones
- `pnpm explore`: autonomous exploration and coverage discovery
- `pnpm heal`: diagnosis and repair of seeded defects
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

Guided QA:

```bash
pnpm qa todo-angular
pnpm qa
```

Autonomous exploration:

```bash
pnpm explore todo-react
pnpm explore
```

Self-heal:

```bash
pnpm heal todo-nextjs
pnpm heal
```

Report rebuild:

```bash
pnpm report
pnpm report qa
pnpm report explore
pnpm report heal
```

While a run is active the CLI streams progress logs to the terminal, and the final JSON summary remains on stdout. `pnpm report` prints the latest-per-app-mode selection it used plus the rebuilt report paths.

## Full Benchmark

Typical clean end-to-end run:

```powershell
Remove-Item -Recurse -Force results\qa, results\explore, results\heal, results\compare -ErrorAction SilentlyContinue
pnpm qa --profile full
pnpm explore
pnpm heal
pnpm report
```

This runs all enabled models across all discoverable apps, then rebuilds the final benchmark comparison report under `results/compare/reports`.

## Documentation

- `README.md`: project overview and command map
- `docs/HOW_TO_RUN.md`: installation, run workflows, result inspection, and rebuild usage
- `docs/STAGEHAND_MCP_SETUP.md`: Stagehand-local runtime details
- `specs/todo-web/README.md`: shared todo benchmark contract rules

## Notes

- Local configuration template: `.env.example`
- The CLI and benchmark app server auto-load `.env` from the repository root when present
- Omitting the app for `pnpm qa`, `pnpm explore`, or `pnpm heal` runs that mode across all discoverable benchmark apps and writes one aggregate comparison report
- `pnpm report` rebuilds comparison pages from `results/<mode>/reports/*.json` and writes rebuilt outputs under `results/compare/reports`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
