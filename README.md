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

Benchmark runs now support exact AI cost accounting through Vercel AI Gateway.

- Set `AI_GATEWAY_API_KEY` to route guided, exploration, and self-heal model calls through Gateway while keeping the existing model ids from `experiments/models/registry.yaml`
- `AI_GATEWAY_BASE_URL` is optional and defaults to Vercel's hosted Gateway endpoint
- Gateway is now the only supported real-model path for benchmark execution
- If a Gateway generation lookup fails, the run marks cost as unavailable instead of silently pretending it is exact

Generated reports now include a dedicated cost graph plus an audit table for each experiment family:

- Guided QA: per-model exact cost bar chart plus per-task cost rows
- Autonomous exploration: stacked per-model chart split into exploration and probe replay cost
- Self-heal: stacked per-model chart split into reproduction, repair, and post-patch replay cost

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
- Exact cost tracking and model access both require `AI_GATEWAY_API_KEY`
- Guided QA stays scenario-driven: each task is a high-level user intent plus an explicit expected outcome
- Autonomous exploration records discovered states, transitions, and reusable actions before scoring coverage
- Self-heal benchmarks diagnose seeded bugs, propose patches, validate them in an isolated worktree, and record repair outcomes
- Generated outputs are written under `results/qa`, `results/explore`, and `results/heal`
- JSON summaries live under `results/<experiment>/reports` and full run artifacts live under `results/<experiment>/runs`
- Report JSON now persists the rendered cost graph data, and run artifacts include normalized `usageSummary` / `aiCalls` records for exact-cost auditability
