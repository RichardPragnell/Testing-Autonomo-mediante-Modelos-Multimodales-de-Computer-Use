import { randomUUID } from "node:crypto";
import { loadBenchmarkSuite, listBenchmarkSuites } from "./config/suite.js";
import { describeBenchmarkTarget, listBenchmarkTargets } from "./config/target.js";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { buildModelMetrics } from "./benchmark/score.js";
import { buildSourceCandidates } from "./diagnostics/source-candidates.js";
import { classifyFailure } from "./diagnostics/taxonomy.js";
import { CoverageGraph } from "./graph/state-graph.js";
import {
  persistReport,
  persistRepairAttempt,
  persistRunArtifact,
  persistRunManifest,
  persistTaskArtifacts,
  readReport,
  readRunArtifact
} from "./persistence/store.js";
import { buildBenchmarkReport } from "./reporting/report.js";
import { StagehandAutomationRunner } from "./runner/stagehand-runner.js";
import { runAgentForPatch } from "./self-heal/adapter.js";
import { applyPatchInIsolatedWorktree } from "./self-heal/worktree.js";
import { startAut } from "./runtime/aut.js";
import { prepareRunWorkspace } from "./runtime/workspace.js";
import { getNextStep, getPlanStatus, updatePlanStep } from "./tracking/plan.js";
import { nowIso } from "./utils/time.js";
import { resolveWorkspacePath } from "./utils/fs.js";
import type {
  BenchmarkReport,
  Finding,
  ModelRunSummary,
  RepairAttempt,
  RunBenchmarkInput,
  RunBenchmarkResult,
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

function buildTaskInstruction(
  baseInstruction: string,
  explorationMode: "guided" | "autonomous",
  guidedPrompt?: string
): string {
  if (explorationMode === "guided" && guidedPrompt) {
    return `${guidedPrompt}\n\nTask: ${baseInstruction}`;
  }
  return baseInstruction;
}

export async function runBenchmarkSuite(input: RunBenchmarkInput): Promise<RunBenchmarkResult> {
  const resolvedSuite = await loadBenchmarkSuite({
    suitePath: input.suitePath,
    suite: input.suite
  });

  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const resultsRoot = await resolveWorkspacePath(input.reportsDir ?? resolvedSuite.suite.resultsDir);
  const registry = await loadModelRegistry(modelsPath);
  const models = resolveModelAvailability(registry, resolvedSuite.suite.models);
  const runner = input.runner ?? new StagehandAutomationRunner();
  const runId = `${resolvedSuite.suite.suiteId}-${Date.now()}`;
  const startedAt = nowIso();
  const coverageGraph = new CoverageGraph();
  const findings: Finding[] = [];
  const modelSummaries: ModelRunSummary[] = [];
  const repairs: RepairAttempt[] = [];
  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });

  const autHandle = await startAut(workspace.aut).catch((error) => {
    throw new Error(`failed to start benchmark target: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    for (const model of models) {
      if (!model.available) {
        modelSummaries.push({
          model,
          metrics: buildModelMetrics(model.id, [], resolvedSuite.tasks.length * resolvedSuite.suite.trials),
          taskRuns: []
        });
        continue;
      }

      const taskRuns: TaskRunResult[] = [];
      for (let trial = 1; trial <= resolvedSuite.suite.trials; trial += 1) {
        let previousState = coverageGraph.upsertState({ url: workspace.aut.url });
        for (const task of resolvedSuite.tasks) {
          const result = await runner.runTask({
            model,
            task: {
              ...task,
              instruction: buildTaskInstruction(
                task.instruction,
                resolvedSuite.suite.explorationMode,
                resolvedSuite.prompts.guided
              )
            },
            trial,
            aut: workspace.aut,
            runConfig: {
              timeoutMs: resolvedSuite.suite.timeoutMs,
              retryCount: resolvedSuite.suite.retryCount,
              maxSteps: resolvedSuite.suite.maxSteps,
              viewport: resolvedSuite.suite.viewport
            }
          });
          taskRuns.push(result);

          const nextState = coverageGraph.upsertState({
            url: result.urlAfter ?? workspace.aut.url,
            domSnapshot: result.domSnapshot,
            screenshotBase64: result.screenshotBase64
          });
          coverageGraph.addTransition(previousState, nextState, task.instruction);
          previousState = nextState;

          const artifactRefs = await persistTaskArtifacts(resultsRoot, runId, model.id, result);
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
              sourceCandidates: buildSourceCandidates({
                workspacePath: workspace.workspacePath,
                suite: resolvedSuite,
                task,
                result,
                category,
                message: reason
              }),
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
    suiteId: resolvedSuite.suite.suiteId,
    targetId: resolvedSuite.suite.targetId,
    scenarioIds: resolvedSuite.suite.scenarioIds,
    bugIds: resolvedSuite.suite.bugIds,
    explorationMode: resolvedSuite.suite.explorationMode,
    workspacePath: workspace.workspacePath,
    startedAt,
    finishedAt,
    suiteSnapshot: resolvedSuite,
    modelSummaries,
    findings,
    coverageGraph: coverageGraph.snapshot()
  };

  const artifactPath = await persistRunArtifact(resultsRoot, artifact);
  await persistRunManifest(resultsRoot, artifact);
  const report: BenchmarkReport = buildBenchmarkReport({
    runId,
    suiteId: resolvedSuite.suite.suiteId,
    targetId: resolvedSuite.suite.targetId,
    scenarioIds: resolvedSuite.suite.scenarioIds,
    bugIds: resolvedSuite.suite.bugIds,
    explorationMode: resolvedSuite.suite.explorationMode,
    modelSummaries,
    findings,
    repairs
  });
  const reportPath = await persistReport(resultsRoot, report);

  return {
    artifact,
    report,
    artifactPath,
    reportPath
  };
}

export async function getBenchmarkReport(runId: string, resultsRoot = "results"): Promise<BenchmarkReport> {
  const resolvedResultsRoot = await resolveWorkspacePath(resultsRoot);
  return readReport(resolvedResultsRoot, runId);
}

export async function compareBenchmarkRuns(runIds: string[], resultsRoot = "results"): Promise<{
  reports: BenchmarkReport[];
  aggregateLeaderboard: Array<{ modelId: string; avgScore: number; runs: number }>;
}> {
  const reports = await Promise.all(runIds.map((runId) => getBenchmarkReport(runId, resultsRoot)));
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
  const resultsRoot = await resolveWorkspacePath(input.outputDir ?? "results");
  const artifact = await readRunArtifact(resultsRoot, input.runId);
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
    await persistRepairAttempt(resultsRoot, input.runId, missingAttempt);
    return missingAttempt;
  }

  const patchContext = {
    runId: artifact.runId,
    suiteId: artifact.suiteId,
    targetId: artifact.targetId,
    bugIds: artifact.bugIds,
    finding,
    suiteSnapshot: artifact.suiteSnapshot,
    repairPrompt: artifact.suiteSnapshot.prompts.repair
  };
  const patchResult = await runAgentForPatch({
    command: input.agentCommand,
    context: patchContext,
    cwd: input.cwd ?? artifact.workspacePath
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
    await persistRepairAttempt(resultsRoot, input.runId, noPatch);
    return noPatch;
  }

  const worktreeResult = await applyPatchInIsolatedWorktree({
    cwd: artifact.workspacePath,
    patch: patchResult.patch,
    validationCommand:
      input.validationCommand ??
      artifact.suiteSnapshot.selectedBugs.find((bug) => bug.validationCommand)?.validationCommand ??
      artifact.suiteSnapshot.target.target.defaultValidationCommand,
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
  await persistRepairAttempt(resultsRoot, input.runId, attempt);
  return attempt;
}

export function listTargets(): Promise<Awaited<ReturnType<typeof listBenchmarkTargets>>> {
  return listBenchmarkTargets();
}

export function listSuites(): Promise<Awaited<ReturnType<typeof listBenchmarkSuites>>> {
  return listBenchmarkSuites();
}

export function describeTarget(targetId: string): Promise<Awaited<ReturnType<typeof describeBenchmarkTarget>>> {
  return describeBenchmarkTarget(targetId);
}

export const runExperiment = runBenchmarkSuite;
export const getReport = getBenchmarkReport;
export const compareModels = compareBenchmarkRuns;

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
