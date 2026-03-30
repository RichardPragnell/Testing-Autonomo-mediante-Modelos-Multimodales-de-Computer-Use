# Agentic QA Orchestrator

This repository is a benchmark-first monorepo for local web QA with LLM-driven exploration and self-healing.
The benchmark surface is intentionally narrow: exactly three experiment families are first class.

- `bench qa`: guided scenario execution against clean app clones
- `bench explore`: autonomous exploration and coverage discovery
- `bench heal`: diagnosis and repair of seeded defects

The repository is organized around four concepts:

- `apps/`: benchmark applications kept as pristine templates plus reproducible bug packs
- `packages/`: reusable harness code for execution and CLI usage
- `experiments/`: model registry, prompts, and benchmark definitions
- `results/`: generated workspaces, JSON reports, HTML dashboards, and sample fixtures

The current reference implementation is `apps/todo-react`. The framework-agnostic source of truth is `specs/todo-web/contract.json`; each app-level `benchmark.json` remains the harness binding for one implementation.

## Exact Cost Tracking

Benchmark runs now support exact AI cost accounting through OpenRouter.

- Set `OPENROUTER_API_KEY` to route guided, exploration, and self-heal model calls through OpenRouter using the registry ids from `experiments/models/registry.yaml`
- `OPENROUTER_BASE_URL` is optional and defaults to OpenRouter's hosted API endpoint
- OpenRouter is now the only supported real-model path for benchmark execution
- Exact benchmark cost is recorded directly from the provider response usage for each AI call

Generated reports now include a dedicated cost graph plus an audit table for each experiment family:

- Guided QA: per-model exact cost bar chart plus per-task cost rows
- Autonomous exploration: stacked per-model chart split into exploration and probe replay cost
- Self-heal: stacked per-model chart split into reproduction, repair, and post-patch replay cost

## Quick Start

```bash
Copy-Item .env.example .env
pnpm install
pnpm build
pnpm test
```

Run the target app directly:

```bash
pnpm app:todo-react
```

Open `http://127.0.0.1:3101`.

## Benchmark Commands

Guided QA:

```bash
pnpm bench qa todo-react
```

Autonomous exploration:

```bash
pnpm bench explore todo-react
```

Self-heal:

```bash
pnpm bench heal todo-react
```

The CLI now stays intentionally narrow: it only starts runs. While a run is active it streams progress logs to the terminal, and the final JSON summary remains on stdout. Inspect the generated JSON and HTML files directly under `results/<experiment>/reports`.

## Notes

- Local configuration template: `.env.example`
- The CLI and benchmark app server auto-load `.env` from the repository root when present
- Exact cost tracking and model access both require `OPENROUTER_API_KEY`
- Guided QA stays scenario-driven: each task is a high-level user intent plus an explicit expected outcome
- Autonomous exploration records discovered states, transitions, and reusable actions before scoring coverage
- Self-heal benchmarks diagnose seeded bugs, propose patches, validate them in an isolated worktree, and record repair outcomes
- Generated outputs are written under `results/qa`, `results/explore`, and `results/heal`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
- Report JSON now persists the rendered cost graph data, and run artifacts include normalized `usageSummary` / `aiCalls` records for exact-cost auditability
