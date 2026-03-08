# Stagehand Local Runtime and Docs Setup

This repository runs Stagehand locally against benchmark app clones created under `results/runs/<runId>/workspace`.
Browserbase cloud is not required for experiment execution.

## Runtime mode
- `packages/harness-core/src/runner/stagehand-runner.ts` uses `env: "LOCAL"`.
- Benchmark apps are started from the cloned workspace using the selected target manifest from `apps/<targetId>/target.json`.
- Model access still comes from provider APIs such as OpenAI, Anthropic, or Google.

## Required model provider variables
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

Only the variables needed by the models enabled in `experiments/models/registry.yaml` must be present.
The repo auto-loads these values from a root `.env` file when present. Start from `.env.example`.

## Optional local browser variables
- `STAGEHAND_LOCAL_BROWSER_PATH`
- `STAGEHAND_LOCAL_HEADLESS`
- `STAGEHAND_LOCAL_DEVTOOLS`
- `STAGEHAND_LOCAL_BROWSER_ARGS`

These are passed into Stagehand local browser launch options when defined.

## Local run examples
1. Start the pristine benchmark target directly:
   `npx pnpm@9.12.3 app:pulse-lab`
2. Run a benchmark suite through the harness:
   `npx pnpm@9.12.3 --filter @agentic-qa/harness-cli bench run --suite experiments/suites/pulse-lab-guided-bugged.json`

## Optional docs MCP
Stagehand documentation can still be attached to your coding client through the public MCP endpoint:

`https://docs.stagehand.dev/mcp`
