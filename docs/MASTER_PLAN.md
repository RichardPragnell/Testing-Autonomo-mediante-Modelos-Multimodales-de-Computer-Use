# Master Cleanup and Simplification Plan

This document is the repo-wide cleanup roadmap. It consolidates three separate planning passes:
- operator surface and documentation cleanup
- `harness-core` architecture simplification
- benchmark target and fixture maintenance cleanup

The goal is to reduce conceptual ambiguity, remove duplication, and make the benchmark harness easier to extend without changing the research direction.

## Workstream A: Operator Surface and Docs

1. Make the documentation map authoritative.
   `README.md` should stay an overview plus quickstart, `docs/HOW_TO_RUN.md` should stay the operational runbook, and `docs/STAGEHAND_MCP_SETUP.md` should stay Stagehand-runtime-specific only. Remove duplicate command inventories and repeated definitions from other docs.
2. Draw a hard boundary between CLI and MCP.
   Document the CLI as the benchmark and reporting surface. Document MCP as the runtime exploration and guided-runtime surface. Use the same vocabulary everywhere: `benchmark suite`, `runtime exploration`, `guided runtime`, and `self-heal`.
3. Reduce user-facing entrypoints to three workflows.
   Reframe docs, examples, and command tables around: run a benchmark suite, run runtime exploration or guided runtime, and repair a finding.
4. Add doc drift guards.
   Add checks that fail when docs reference missing files or list commands and tools that do not exist. The prior stale `docs/MASTER_PLAN.md` reference is the exact class of issue this should prevent.

## Workstream B: Harness-Core Simplification

1. Split `service.ts` by workflow.
   Break the current orchestration into benchmark suite runs, runtime guided runs, runtime exploration runs, and self-heal. Keep one thin public facade that wires dependencies and re-exports the workflows.
2. Break `types.ts` into domain files.
   Separate benchmark config, execution/runtime, exploration, persistence/reporting, repair, and plan-tracking types. Keep stable public contracts separate from volatile internal DTOs.
3. Narrow the runner boundary.
   Replace the broad `AutomationRunner` shape with smaller capabilities for guided execution, autonomous exploration, and optional cache-hint support. Isolate Stagehand-specific normalization behind a typed adapter so `any` does not leak through the codebase.
4. Introduce one shared run-context builder.
   Centralize model resolution, runtime defaults, prompt resolution, workspace setup, and AUT startup so benchmark, MCP guided, and MCP exploration flows stop duplicating setup logic.
5. Move domain rules out of orchestration.
   Extract cache-hint matching, exploration compatibility checks, finding construction, and artifact summary assembly into focused helpers or services.
6. Normalize persistence and reporting boundaries.
   Introduce an explicit `ArtifactStore` layer for benchmark runs, exploration runs, reports, task artifacts, and repair attempts. Make the on-disk layout stable and documented before changing report or reuse behavior.
7. Rebuild tests around fixtures and helpers.
   Split the current large integration file by workflow and add shared builders for registries, suites, workspaces, and artifact assertions.
8. Decide artifact compatibility policy before deeper refactors.
   Either version serializers and keep old artifacts readable, or explicitly treat cleanup as a breaking internal reset and simplify aggressively.

## Workstream C: Benchmark Fixtures and Repo Hygiene

1. Create one source-of-truth benchmark manifest for `todo-react`.
   Define canonical target metadata, stable task ids, bug ids, default labels, and clean vs bugged suite permutations in one structured file.
2. Normalize scenario semantics around capability, not mode.
   Keep `smoke` as baseline availability checks. Rework guided task ids around capabilities such as add, complete, filter, edit, and create-delete. Keep the invariant that scenario tasks describe user intent plus expected outcome, never low-level navigation steps.
3. Pull benchmark literals into shared fixture constants.
   Centralize default todo labels, edited labels, created task names, and other recurring benchmark strings so scenarios, tests, bug packs, and sample fixtures do not drift independently.
4. Add a fixture validation script.
   Validate that every `expectedFailureTaskId` exists, every patch still applies to the current template, every suite references valid scenario ids and prompt ids, and every sample fixture references current suite and bug ids.
5. Collapse duplicated suite configuration.
   Derive guided vs autonomous and clean vs bugged suites from shared defaults or a generator so model lists, viewport, timeout, retry, and prompt wiring stop drifting across near-duplicate JSON files.
6. Simplify prompt maintenance.
   Introduce a shared base benchmark QA prompt with small guided-only and autonomous-only deltas rather than maintaining fully separate prompt files that can diverge semantically.
7. Separate benchmark app behavior from benchmark fixture concerns.
   Keep the app template focused on product behavior and local tests. Move benchmark-specific labels, maintenance notes, and suite-generation metadata out of component files where possible.
8. Automate sample fixture generation.
   Treat `results/samples` as generated output tied to the benchmark manifest, not hand-authored JSON.

## Cross-Cutting Risks

- Splitting orchestration too aggressively can break current CLI or MCP behavior unless run contracts are locked first.
- Persistence cleanup can silently break exploration reuse if artifact compatibility rules are not made explicit first.
- Renaming task ids or regenerating suites will break bug mappings, sample fixtures, and historical artifacts unless migrated in one pass.
- Over-normalizing prompts or generated defaults can blur the intended difference between guided and autonomous modes.

## Suggested Sequence

1. Fix the documentation map and operator vocabulary first.
2. Add fixture and doc drift guards second, so cleanup work has a safety net.
3. Introduce shared runtime or run-context builders and split orchestration by run kind.
4. Normalize persistence and runner boundaries once workflow boundaries are stable.
5. Introduce the source-of-truth benchmark manifest, shared constants, and generated suites.
6. Collapse prompts into base plus delta structure.
7. Replace hand-maintained sample fixtures with deterministic generation.
