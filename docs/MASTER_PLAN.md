# Master Plan: Benchmark-First Hybrid Lab

This file is the source of truth for implementation progress. Step statuses must be one of:
`not_started`, `in_progress`, `blocked`, `done`, `verified`.

## Research Objective
This repository is building the benchmark lab and execution loop first. That base includes local AUT cloning, guided and autonomous exploration, multimodal diagnosis artifacts, and isolated self-heal.

The broader research goal is to use that base to compare:
- different QA harnesses and orchestration approaches
- different computer-use and multimodal models
- different benchmark app designs and seeded defect sets
- different commonly used web frameworks, starting with vanilla JS and React and expanding later to additional stacks

## Session Workflow
1. Start session: inspect `experiments/suites/` and the current target manifests under `apps/`.
2. During work: append milestone, failure, retry, and status events to `docs/progress/events.jsonl`.
3. End session: mark `done` only when implementation exists and evidence is captured.
4. Validation cycle: mark `verified` after an independent rerun or automated validation.

## Steps
### B0
- step_id: B0
- goal: Refactor the repository into a benchmark-first hybrid lab layout with explicit `apps/`, `packages/`, `experiments/`, and `results/` roots.
- definition_of_done: The old generic experiment layout is removed, new roots exist, and build plus tests pass on the renamed harness packages.
- evidence_required: Workspace build and test output.
- owner: codex
- status: verified
- last_update: 2026-03-08

### B1
- step_id: B1
- goal: Catalog Pulse Lab as the first benchmark target with a pristine template, scenario files, and explicit bug packs.
- definition_of_done: `apps/pulse-lab` contains `target.json`, `template/`, `scenarios/`, and `bugs/`, and bug packs reproduce seeded deviations on clean clones.
- evidence_required: Target manifest, bug pack patches, and workspace preparation test.
- owner: codex
- status: verified
- last_update: 2026-03-08

### B2
- step_id: B2
- goal: Execute benchmark suites by resolving target ids, cloning workspaces, applying bug packs, and persisting run artifacts under `results/`.
- definition_of_done: Suites load from `experiments/suites`, results land in `results/runs` and `results/reports`, and run artifacts include target, bug, scenario, exploration, and workspace metadata.
- evidence_required: Integration test and sample report fixture.
- owner: codex
- status: verified
- last_update: 2026-03-08

### B3
- step_id: B3
- goal: Expose the benchmark-first surface through `bench` CLI commands and `bench.*` MCP tools.
- definition_of_done: CLI supports list, describe, run, report, compare, and heal; MCP exposes the same benchmark operations.
- evidence_required: CLI smoke tests and MCP tool contract tests.
- owner: codex
- status: verified
- last_update: 2026-03-08

### B4
- step_id: B4
- goal: Implement explicit comparison outputs between guided and autonomous exploration modes on the same target and bug set.
- definition_of_done: At least two suites differ only by exploration mode and reports are directly comparable across those runs.
- evidence_required: Guided and autonomous suite fixtures plus comparison run evidence.
- owner: codex
- status: done
- last_update: 2026-03-08

### B5
- step_id: B5
- goal: Extend findings with source-candidate hints that connect DOM and route evidence to likely files inside the cloned benchmark workspace.
- definition_of_done: Failed tasks include ranked source candidates derived from target structure and multimodal evidence.
- evidence_required: Example finding artifact plus tests.
- owner: codex
- status: verified
- last_update: 2026-03-08
