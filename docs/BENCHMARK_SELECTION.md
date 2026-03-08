# Benchmark Selection Notes

Date: 2026-03-08

## Decision
For the first research cycle, this repository will use a local AUT that lives inside the monorepo instead of adopting an external benchmark as the primary evaluation target.

## Candidates Reviewed
- WebArena: good for autonomous navigation benchmarks, but heavy to self-host and not designed around patching the AUT source after failures.
- BrowserGym: useful as an agent evaluation framework, but broader than the immediate need and not centered on editable seeded UI faults.
- E2EGit: interesting for code-related automation, but not a clean fit for deterministic local UI bug diagnosis and repair loops.

## Why A Local AUT Wins First
- The code under test is available in the same repository, which is mandatory for closed-loop QA and self-heal experiments.
- Faults can be seeded deliberately and kept deterministic across reruns.
- Exploration comparisons can be repeated under identical local conditions without external product drift.
- The AUT can evolve together with the experiment corpus, diagnosis schema, and repair harness.

## Follow-Up
Once the local pipeline is stable, add a second AUT or a thin imported benchmark slice for external validity.
