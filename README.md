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

The current benchmark target is `apps/todo-react`. Its source of truth is `apps/todo-react/benchmark.json`, which defines the guided QA capabilities, exploration rubric, and heal cases in one place.

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
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench qa run --app todo-react
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench qa report --run-id <runId>
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench qa compare --run-ids <runIdA> <runIdB>
```

Autonomous exploration:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench explore run --app todo-react
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench explore report --run-id <runId>
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench explore compare --run-ids <runIdA> <runIdB>
```

Self-heal:

```bash
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal run --app todo-react
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal report --run-id <runId>
npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal compare --run-ids <runIdA> <runIdB>
```

The default model registry lives in `experiments/models/registry.yaml`. Pass `--models-path path/to/registry.yaml` when you want to compare a different registry.

## Notes

- Local configuration template: `.env.example`
- The CLI and benchmark app server auto-load `.env` from the repository root when present
- Guided QA stays scenario-driven: each task is a high-level user intent plus an explicit expected outcome
- Autonomous exploration records discovered states, transitions, and reusable actions before scoring coverage
- Self-heal benchmarks diagnose seeded bugs, propose patches, validate them in an isolated worktree, and record repair outcomes
- Generated outputs are written under `results/qa`, `results/explore`, and `results/heal`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
