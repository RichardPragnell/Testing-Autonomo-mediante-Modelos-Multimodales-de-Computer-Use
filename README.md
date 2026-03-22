# Agentic QA Orchestrator

This repository is a benchmark-first monorepo for local web QA with LLM-driven exploration and self-healing.
The current implementation is the base platform for the research, not the final benchmark itself: it establishes the local execution loop, benchmark app structure, diagnosis artifacts, and repair workflow that later experiments will use.
The actual project objective is to benchmark different combinations of:
- web QA harnesses and orchestration strategies
- computer-use and multimodal models
- benchmark apps with seeded defects
- commonly used web application frameworks such as vanilla JS, React, and future additions like Vue, Angular, or similar stacks

It is organized around four explicit concepts:
- `apps/`: benchmark web applications kept as pristine templates plus reproducible bug packs
- `packages/`: reusable harness code for execution, CLI usage, and MCP exposure
- `experiments/`: model registries, benchmark suites, and prompt presets
- `results/`: generated run workspaces, reports, and committed sample fixtures

The current benchmark target is `apps/todo-react`. Each run clones its template into `results/runs/<runId>/workspace`, applies a selected set of bug packs, starts the app locally, and then lets the harness evaluate guided scenarios, autonomous exploration, diagnosis, and repair behavior against that isolated workspace.

## Repository Structure
- `apps/todo-react`: React-based benchmark target with smoke and guided scenarios plus seeded bug packs
- `packages/harness-core`: suite loading, target resolution, workspace prep, Stagehand execution, reporting, and self-heal
- `packages/harness-cli`: `bench` CLI surface
- `packages/harness-mcp`: MCP server exposing the benchmark operations
- `experiments/models`: model registry
- `experiments/suites`: comparable benchmark suite configs
- `experiments/prompts`: reusable guided, autonomous, and repair prompts
- `results/samples`: committed report fixture examples

## Doc Map
- `README.md`: project overview, quickstart, and entrypoint map
- `docs/HOW_TO_RUN.md`: current operational workflow
- `docs/STAGEHAND_MCP_SETUP.md`: Stagehand-local runtime specifics
- `docs/MASTER_PLAN.md`: cleanup and simplification roadmap

## Important Commands

### Setup
- Create a local env file: `Copy-Item .env.example .env`
- Install dependencies: `npx pnpm@9.12.3 install`
- Build all workspace packages: `npx pnpm@9.12.3 build`
- Run the full test suite: `npx pnpm@9.12.3 test`

### Benchmark Target
- Start the React todo app directly: `npx pnpm@9.12.3 app:todo-react`

### Bench CLI
- List targets: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list targets`
- List suites: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list suites`
- Describe a target: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench describe target --target todo-react`
- Run a suite: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/todo-react-guided-bugged.json`
- Read a report: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench report --run-id <runId>`
- Compare runs: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench compare --run-ids <runIdA> <runIdB>`
- Run self-heal: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal --run-id <runId> --finding-id <findingId> --agent-command "<your-agent-command>"`

### MCP Server
- Start the MCP server: `npx pnpm@9.12.3 --filter @agentic-qa/harness-mcp start`
- Exposed tools:
  `bench.run_suite`
  `bench.explore_target`
  `bench.run_guided`
  `bench.get_report`
  `bench.compare_runs`
  `bench.run_self_heal`
  `bench.list_targets`
  `bench.list_suites`
  `bench.describe_target`

## Notes
- Local configuration template: `.env.example`
- The CLI, MCP server, benchmark runs, and local benchmark app server auto-load `.env` from the repository root when present.
- End-to-end runbook: `docs/HOW_TO_RUN.md`
- Stagehand is configured for local runtime, not Browserbase cloud. See `docs/STAGEHAND_MCP_SETUP.md`.
- The default model registry lives in `experiments/models/registry.yaml`.
- Guided benchmark runs remain scenario-driven: each scenario task is a high-level user intent plus an explicit expected outcome.
- Autonomous benchmark runs explore first, persist Stagehand history plus graph or action-cache artifacts, and then evaluate the selected scenarios.
- Generated outputs are written to `results/runs` and `results/reports`; only `results/samples` is meant to be committed.
- Research planning lives in `docs/MASTER_PLAN.md`.
- Benchmark selection notes live in `docs/BENCHMARK_SELECTION.md`.

## Cleanup Roadmap
- The current cleanup and simplification plan is tracked in `docs/MASTER_PLAN.md`.
- The roadmap is organized into three workstreams: operator surfaces and docs, `harness-core` simplification, and benchmark fixture or repo hygiene.
- The first cleanup phase is documentation vocabulary and drift guards, followed by workflow or persistence refactors, then fixture generation and suite normalization.
- Use that plan before adding new commands, docs, or result artifacts so the project surface stays coherent.
