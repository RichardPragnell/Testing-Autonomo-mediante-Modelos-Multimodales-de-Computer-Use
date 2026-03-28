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

## Quick Start

```bash
Copy-Item .env.example .env
npx pnpm@9.12.3 install
npx pnpm@9.12.3 build
npx pnpm@9.12.3 test
```

Run the target app directly:

```bash
npx pnpm@9.12.3 app:todo-react
```

Open `http://127.0.0.1:3101`.

## Benchmark Commands

Guided QA:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench qa todo-react
```

Autonomous exploration:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench explore todo-react
```

Self-heal:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal todo-react
```

The CLI now stays intentionally narrow: it only starts runs. Inspect the generated JSON and HTML files directly under `results/<experiment>/reports`.

## Notes

- Local configuration template: `.env.example`
- The CLI and benchmark app server auto-load `.env` from the repository root when present
- Guided QA stays scenario-driven: each task is a high-level user intent plus an explicit expected outcome
- Autonomous exploration records discovered states, transitions, and reusable actions before scoring coverage
- Self-heal benchmarks diagnose seeded bugs, propose patches, validate them in an isolated worktree, and record repair outcomes
- Generated outputs are written under `results/qa`, `results/explore`, and `results/heal`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
