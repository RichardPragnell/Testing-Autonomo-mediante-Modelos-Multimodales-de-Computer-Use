# Agentic QA Orchestrator

Monorepo for Stagehand-driven QA automation with multi-model benchmarking, multimodal diagnostics, self-healing, and graph-based exploration.

## Quick Start
1. Install dependencies: `npx pnpm@9.12.3 install`
2. Build: `npx pnpm@9.12.3 build`
3. Run tests: `npx pnpm@9.12.3 test`
4. Check plan status: `npx pnpm@9.12.3 --filter @agentic-qa/cli cli plan status`

## CLI
- Run experiment: `npx pnpm@9.12.3 --filter @agentic-qa/cli cli qa run --spec config/experiments/local-smoke.json`
- Read report: `npx pnpm@9.12.3 --filter @agentic-qa/cli cli qa report --run-id <runId>`
- Compare runs: `npx pnpm@9.12.3 --filter @agentic-qa/cli cli qa compare --run-ids <runIdA> <runIdB>`
- Self-heal: `npx pnpm@9.12.3 --filter @agentic-qa/cli cli qa heal --run-id <runId> --finding-id <findingId> --agent-command \"<your-agent-command>\"`

## MCP Server
- Start MCP server on stdio: `npx pnpm@9.12.3 --filter @agentic-qa/mcp-server start`
- Tool names: `qa.run_experiment`, `qa.get_report`, `qa.compare_models`, `qa.run_self_heal`, `plan.status`, `plan.updateStep`, `plan.next`
- Stagehand docs MCP setup details: `docs/STAGEHAND_MCP_SETUP.md`

## Tracking
- Plan source of truth: `docs/MASTER_PLAN.md`
- Structured progress log: `docs/progress/events.jsonl`
- Sample report fixture: `reports/samples/sample-report.json`
