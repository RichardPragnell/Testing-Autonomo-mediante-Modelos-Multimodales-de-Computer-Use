import { randomUUID } from "node:crypto";
import { loadExperimentSpec } from "./config/experiment.js";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { buildModelMetrics } from "./benchmark/score.js";
import { classifyFailure } from "./diagnostics/taxonomy.js";
import { CoverageGraph } from "./graph/state-graph.js";
import { persistReport, persistRepairAttempt, persistRunArtifact, persistTaskArtifacts, readReport, readRunArtifact } from "./persistence/store.js";
import { buildExperimentReport } from "./reporting/report.js";
import { StagehandAutomationRunner } from "./runner/stagehand-runner.js";
import { runAgentForPatch } from "./self-heal/adapter.js";
import { applyPatchInIsolatedWorktree } from "./self-heal/worktree.js";
import { startAut } from "./runtime/aut.js";
import { appendPlanEvent, getNextStep, getPlanStatus, updatePlanStep } from "./tracking/plan.js";
import { nowIso } from "./utils/time.js";
import type {
  ExperimentReport,
  Finding,
  ModelRunSummary,
  RepairAttempt,
  RunExperimentInput,
  RunExperimentResult,
  TaskRunResult
} from "./types.js";

function severityFromCategory(category: ReturnType<typeof classifyFailure>): "low" | "medium" | "high" {
  if (category === "timeout" || category === "navigation") {
    return "high";
  }
  if (category === "assertion" || category === "locator") {
    return "medium";
  }
  return "low";
}

export async function runExperiment(input: RunExperimentInput): Promise<RunExperimentResult> {
  const spec = await loadExperimentSpec({
    specPath: input.specPath,
    spec: input.spec
  });

  const registry = await loadModelRegistry(input.modelsPath ?? "config/models.yaml");
  const models = resolveModelAvailability(registry, spec.models);
  const runner = input.runner ?? new StagehandAutomationRunner();
  const runId = `${spec.experimentId}-${Date.now()}`;
  const startedAt = nowIso();
  const coverageGraph = new CoverageGraph();
  const findings: Finding[] = [];
  const modelSummaries: ModelRunSummary[] = [];
  const repairs: RepairAttempt[] = [];

  const autHandle = await startAut(spec.aut).catch((error) => {
    throw new Error(`failed to start AUT: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    for (const model of models) {
      if (!model.available) {
        modelSummaries.push({
          model,
          metrics: buildModelMetrics(model.id, [], spec.tasks.length * spec.trials),
          taskRuns: []
        });
        continue;
      }

      const taskRuns: TaskRunResult[] = [];
      for (let trial = 1; trial <= spec.trials; trial += 1) {
        let previousState = coverageGraph.upsertState({ url: spec.aut.url });
        for (const task of spec.tasks) {
          const result = await runner.runTask({
            model,
            task,
            trial,
            aut: spec.aut,
            runConfig: {
              timeoutMs: spec.timeoutMs,
              retryCount: spec.retryCount,
              maxSteps: spec.maxSteps,
              viewport: spec.viewport
            }
          });
          taskRuns.push(result);

          const nextState = coverageGraph.upsertState({
            url: result.urlAfter ?? spec.aut.url,
            domSnapshot: result.domSnapshot,
            screenshotBase64: result.screenshotBase64
          });
          coverageGraph.addTransition(previousState, nextState, task.instruction);
          previousState = nextState;

          const artifactRefs = await persistTaskArtifacts(spec.outputDir, runId, model.id, result);
          if (!result.success) {
            const reason = result.error ?? result.message;
            const category = classifyFailure(reason);
            findings.push({
              id: randomUUID(),
              runId,
              modelId: model.id,
              taskId: task.id,
              trial,
              severity: severityFromCategory(category),
              category,
              message: reason,
              artifacts: artifactRefs,
              createdAt: nowIso()
            });
          }
        }
      }

      modelSummaries.push({
        model,
        metrics: buildModelMetrics(model.id, taskRuns, 0),
        taskRuns
      });
    }
  } finally {
    await autHandle?.stop();
  }

  const finishedAt = nowIso();
  const artifact = {
    runId,
    experimentId: spec.experimentId,
    startedAt,
    finishedAt,
    spec,
    modelSummaries,
    findings,
    coverageGraph: coverageGraph.snapshot()
  };

  const artifactPath = await persistRunArtifact(spec.outputDir, artifact);
  const report: ExperimentReport = buildExperimentReport({
    runId,
    experimentId: spec.experimentId,
    modelSummaries,
    findings,
    repairs
  });
  const reportPath = await persistReport(input.reportsDir ?? "reports/runs", report);

  await appendPlanEvent("docs/progress/events.jsonl", {
    timestamp: nowIso(),
    type: "milestone",
    note: `Experiment ${runId} completed`,
    evidence: [artifactPath, reportPath],
    metadata: { experimentId: spec.experimentId }
  });

  return {
    artifact,
    report,
    artifactPath,
    reportPath
  };
}

export async function getReport(runId: string): Promise<ExperimentReport> {
  return readReport("reports/runs", runId);
}

export async function compareModels(runIds: string[]): Promise<{
  reports: ExperimentReport[];
  aggregateLeaderboard: Array<{ modelId: string; avgScore: number; runs: number }>;
}> {
  const reports = await Promise.all(runIds.map((runId) => getReport(runId)));
  const scoreMap = new Map<string, number[]>();
  for (const report of reports) {
    for (const item of report.leaderboard) {
      const current = scoreMap.get(item.modelId) ?? [];
      current.push(item.score);
      scoreMap.set(item.modelId, current);
    }
  }
  const aggregateLeaderboard = [...scoreMap.entries()]
    .map(([modelId, scores]) => ({
      modelId,
      avgScore: Number((scores.reduce((acc, value) => acc + value, 0) / scores.length).toFixed(3)),
      runs: scores.length
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return { reports, aggregateLeaderboard };
}

export async function runSelfHeal(input: {
  runId: string;
  findingId: string;
  agentCommand: string;
  validationCommand?: string;
  outputDir?: string;
  cwd?: string;
}): Promise<RepairAttempt> {
  const outputDir = input.outputDir ?? "artifacts/runs";
  const cwd = input.cwd ?? process.cwd();
  const artifact = await readRunArtifact(outputDir, input.runId);
  const finding = artifact.findings.find((item) => item.id === input.findingId);
  const attemptId = `repair-${Date.now()}`;

  if (!finding) {
    const missingAttempt: RepairAttempt = {
      attemptId,
      runId: input.runId,
      findingId: input.findingId,
      outcome: "skipped",
      note: `finding ${input.findingId} not found in run ${input.runId}`,
      createdAt: nowIso()
    };
    await persistRepairAttempt(outputDir, input.runId, missingAttempt);
    return missingAttempt;
  }

  const patchContext = {
    runId: artifact.runId,
    experimentId: artifact.experimentId,
    finding,
    spec: artifact.spec
  };
  const patchResult = await runAgentForPatch({
    command: input.agentCommand,
    context: patchContext,
    cwd
  });

  if (!patchResult.patch) {
    const noPatch: RepairAttempt = {
      attemptId,
      runId: input.runId,
      findingId: input.findingId,
      outcome: "not_fixed",
      note: `agent produced no valid unified diff (exit ${patchResult.exitCode})`,
      createdAt: nowIso()
    };
    await persistRepairAttempt(outputDir, input.runId, noPatch);
    return noPatch;
  }

  const worktreeResult = await applyPatchInIsolatedWorktree({
    cwd,
    patch: patchResult.patch,
    validationCommand: input.validationCommand ?? "npx pnpm@9.12.3 test",
    attemptId
  });

  const attempt: RepairAttempt = {
    attemptId,
    runId: input.runId,
    findingId: input.findingId,
    outcome: worktreeResult.outcome,
    note: worktreeResult.note,
    patchPath: worktreeResult.patchPath,
    validationExitCode: worktreeResult.validationExitCode,
    createdAt: nowIso()
  };
  await persistRepairAttempt(outputDir, input.runId, attempt);
  return attempt;
}

export function planStatus(): Promise<Awaited<ReturnType<typeof getPlanStatus>>> {
  return getPlanStatus();
}

export function planUpdate(input: {
  stepId: string;
  status: "not_started" | "in_progress" | "blocked" | "done" | "verified";
  note: string;
  evidence: string[];
}): Promise<Awaited<ReturnType<typeof updatePlanStep>>> {
  return updatePlanStep(input);
}

export function planNext(): Promise<Awaited<ReturnType<typeof getNextStep>>> {
  return getNextStep();
}
