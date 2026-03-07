# Master Plan: Stagehand Agentic QA Orchestrator

This file is the source of truth for implementation progress. Step statuses must be one of:
`not_started`, `in_progress`, `blocked`, `done`, `verified`.

## Session Workflow
1. Start session: run `plan status` and pick the current `in_progress` step or call `plan next`.
2. During work: append milestone/failure/retry events to `docs/progress/events.jsonl`.
3. End session: mark `done` only when DoD and evidence are present.
4. Validation cycle: mark `verified` after independent rerun/validation.

## Steps
### P0
- step_id: P0
- goal: Bootstrap pnpm monorepo with `core`, `cli`, and `mcp-server`; add shared config and baseline test/lint setup.
- definition_of_done: Workspace builds; all packages resolve; baseline unit/integration tests execute.
- evidence_required: Build and test command output captured in event log.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P1
- step_id: P1
- goal: Add Stagehand runner abstraction with deterministic settings and Gemini Flash default model.
- definition_of_done: Runner supports local AUT URL, timeout/retry/viewport controls, and default model assignment.
- evidence_required: Unit/integration tests + run artifact showing model selection.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P2
- step_id: P2
- goal: Add declarative model registry with 6+ models and key availability validation.
- definition_of_done: Models loaded from YAML/JSON; unavailable models marked skipped with reason.
- evidence_required: Unit tests + sample run report with skipped/available models.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P3
- step_id: P3
- goal: Add hybrid benchmark corpus support (synthetic + generated) and normalize to common experiment spec.
- definition_of_done: Loader ingests both corpus types and emits normalized task list.
- evidence_required: Unit tests for normalization + sample spec fixture.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P4
- step_id: P4
- goal: Execute comparative benchmarking with repeated trials and composite ranking score.
- definition_of_done: System runs same tasks across models, computes score, and produces leaderboard.
- evidence_required: Integration test + report fixture showing ranking.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P5
- step_id: P5
- goal: Persist multimodal diagnosis artifacts and normalized failure taxonomy.
- definition_of_done: Failures store screenshot + DOM/context + trace + taxonomy category.
- evidence_required: Artifact files + integration test assertions.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P6
- step_id: P6
- goal: Implement self-healing adapter with isolated worktree patch application and revalidation.
- definition_of_done: Adapter executes command, parses unified diff, applies patch in isolated context, and classifies outcome.
- evidence_required: Contract tests for valid/invalid diffs + heal report.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P7
- step_id: P7
- goal: Add graph-based exploration with novelty-driven frontier strategy.
- definition_of_done: State graph uses URL + reduced DOM hash + visual hash; frontier picks novel states first.
- evidence_required: Unit tests for fingerprinting/frontier + coverage snapshot.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P8
- step_id: P8
- goal: Expose QA and plan-tracking operations via MCP and CLI using shared core contracts.
- definition_of_done: CLI and MCP both support run/report/compare/heal and plan.status/plan.updateStep/plan.next.
- evidence_required: MCP contract tests + CLI command smoke tests.
- owner: codex
- status: verified
- last_update: 2026-03-07

### P9
- step_id: P9
- goal: Generate reproducible reports with confidence stats, failure clusters, and repair outcomes.
- definition_of_done: Report includes leaderboard, confidence intervals, taxonomy clusters, and healing summary.
- evidence_required: Report snapshot test + generated sample JSON report.
- owner: codex
- status: verified
- last_update: 2026-03-07
