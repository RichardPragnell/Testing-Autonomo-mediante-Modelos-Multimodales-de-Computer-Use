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

The first benchmark target is `apps/pulse-lab`. Each run clones its template into `results/runs/<runId>/workspace`, applies a selected set of bug packs, starts the app locally, and then lets the harness evaluate exploration, diagnosis, and repair behavior against that isolated workspace.
The repo also includes `apps/todo-react`, a second benchmark target built with React to start covering framework diversity as part of the benchmark matrix.

## Repository Structure
- `apps/pulse-lab`: target manifest, pristine template, bug packs, and scenario files
- `apps/todo-react`: React-based benchmark target with smoke and guided scenarios
- `packages/harness-core`: suite loading, target resolution, workspace prep, Stagehand execution, reporting, and self-heal
- `packages/harness-cli`: `bench` CLI surface
- `packages/harness-mcp`: MCP server exposing the benchmark operations
- `experiments/models`: model registry
- `experiments/suites`: comparable benchmark suite configs
- `experiments/prompts`: reusable guided exploration and repair prompts
- `results/samples`: committed report fixture examples

## Important Commands

### Setup
- Create a local env file: `Copy-Item .env.example .env`
- Install dependencies: `npx pnpm@9.12.3 install`
- Build all workspace packages: `npx pnpm@9.12.3 build`
- Run the full test suite: `npx pnpm@9.12.3 test`

### Benchmark Target
- Start the pristine Pulse Lab app directly: `npx pnpm@9.12.3 app:pulse-lab`
- Start the React todo app directly: `npx pnpm@9.12.3 app:todo-react`
- Target manifest: `apps/pulse-lab/target.json`
- Alternate target manifest: `apps/todo-react/target.json`
- Scenarios:
  `apps/pulse-lab/scenarios/smoke.json`
  `apps/pulse-lab/scenarios/guided.json`
- Bug packs:
  `apps/pulse-lab/bugs/critical-filter-empty`
  `apps/pulse-lab/bugs/preferences-toast-hidden`

### Bench CLI
- List targets: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list targets`
- List suites: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench list suites`
- Describe a target: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench describe target --target pulse-lab`
- Run a suite: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/pulse-lab-guided-bugged.json`
- Read a report: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench report --run-id <runId>`
- Compare runs: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench compare --run-ids <runIdA> <runIdB>`
- Run self-heal: `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench heal --run-id <runId> --finding-id <findingId> --agent-command "<your-agent-command>"`

### MCP Server
- Start the MCP server: `npx pnpm@9.12.3 --filter @agentic-qa/harness-mcp start`
- Exposed tools:
  `bench.run_suite`
  `bench.get_report`
  `bench.compare_runs`
  `bench.run_self_heal`
  `bench.list_targets`
  `bench.list_suites`
  `bench.describe_target`

## Notes
- Local configuration template: `.env.example`
- The CLI, MCP server, benchmark runs, and Pulse Lab local server auto-load `.env` from the repository root when present.
- End-to-end runbook: `docs/HOW_TO_RUN.md`
- Stagehand is configured for local runtime, not Browserbase cloud. See `docs/STAGEHAND_MCP_SETUP.md`.
- The default model registry lives in `experiments/models/registry.yaml`.
- Generated outputs are written to `results/runs` and `results/reports`; only `results/samples` is meant to be committed.
- Research planning lives in `docs/MASTER_PLAN.md`.
- Benchmark selection notes live in `docs/BENCHMARK_SELECTION.md`.
