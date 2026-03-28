import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AutomationRunner, ModelAvailability, OperationTrace, TaskRunResult } from "../types.js";
import { summarizeTaskRunCache } from "../cache/summary.js";
import { loadModelRegistry, resolveModelAvailability } from "../config/model-registry.js";
import { loadProjectEnv } from "../env/load.js";
import { StagehandAutomationRunner } from "../runner/stagehand-runner.js";
import { prepareRunWorkspace } from "../runtime/workspace.js";
import { startAut } from "../runtime/aut.js";
import { ProviderRepairModelClient, type RepairModelClient } from "../self-heal/model-client.js";
import { rebaseAutConfig, withPatchedIsolatedWorktree } from "../self-heal/worktree.js";
import { execCommand } from "../utils/exec.js";
import { nowIso } from "../utils/time.js";
import { ensureDir, resolveWorkspacePath, writeJson, writeText } from "../utils/fs.js";
import { loadAppBenchmark } from "./benchmark.js";
import { buildResolvedSuite, executeGuidedTasks, readCandidateFileSnippets, resolveExperimentRoot, round } from "./common.js";
import { renderExperimentDashboard } from "./report-html.js";
import { computeHealScore } from "./scoring.js";
import type {
  CompareResult,
  HealCaseTrialResult,
  HealExperimentSpec,
  HealLeaderboardEntry,
  HealModelMetrics,
  HealModelSummary,
  HealReport,
  HealRunArtifact,
  HealRunResult
} from "./types.js";

const healPresetSchema = z
  .object({
    caseIds: z.array(z.string()).optional(),
    promptId: z.string().optional(),
    trials: z.number().int().min(1).optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough();

export interface RunHealExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  resultsDir?: string;
  runner?: AutomationRunner;
  repairClient?: RepairModelClient;
}

async function loadHealPreset(pathLike?: string): Promise<z.infer<typeof healPresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return healPresetSchema.parse(JSON.parse(raw));
}

function zeroMetrics(model: ModelAvailability): HealModelMetrics {
  return {
    modelId: model.id,
    localizationAccuracy: 0,
    patchApplyRate: 0,
    validationPassRate: 0,
    failingTaskFixRate: 0,
    regressionFreeRate: 0,
    fixRate: 0,
    avgLatencyMs: 0,
    avgCostUsd: 0,
    score: 0
  };
}

function buildLeaderboard(modelSummaries: HealModelSummary[]): HealLeaderboardEntry[] {
  return [...modelSummaries]
    .sort((left, right) => right.metrics.score - left.metrics.score)
    .map((summary, index) => ({
      rank: index + 1,
      modelId: summary.model.id,
      provider: summary.model.provider,
      score: summary.metrics.score,
      localizationAccuracy: summary.metrics.localizationAccuracy,
      patchApplyRate: summary.metrics.patchApplyRate,
      validationPassRate: summary.metrics.validationPassRate,
      failingTaskFixRate: summary.metrics.failingTaskFixRate,
      regressionFreeRate: summary.metrics.regressionFreeRate,
      fixRate: summary.metrics.fixRate,
      avgLatencyMs: summary.metrics.avgLatencyMs,
      avgCostUsd: summary.metrics.avgCostUsd
    }));
}

function buildReport(artifact: HealRunArtifact): HealReport {
  return {
    kind: "heal",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard: buildLeaderboard(artifact.modelSummaries),
    modelSummaries: artifact.modelSummaries
  };
}

function buildHtml(report: HealReport): string {
  return renderExperimentDashboard({
    title: `${report.appId} Self-Heal Benchmark`,
    subtitle: `Repair quality across ${report.leaderboard.length} model(s).`,
    scoreBars: report.leaderboard.map((entry) => ({
      label: entry.modelId,
      value: entry.score,
      max: 100,
      hint: `${(entry.fixRate * 100).toFixed(1)}% full fix rate`
    })),
    secondaryCharts: [
      {
        title: "Fix Rate",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.fixRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Localization Accuracy",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.localizationAccuracy * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Validation Pass Rate",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.validationPassRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Regression-Free Rate",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.regressionFreeRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      }
    ],
    leaderboardHeaders: ["Rank", "Model", "Score", "Fix", "Localize", "Validate", "Regression", "Latency", "Cost"],
    leaderboardRows: report.leaderboard.map((entry) => [
      entry.rank,
      entry.modelId,
      entry.score.toFixed(3),
      `${(entry.fixRate * 100).toFixed(1)}%`,
      `${(entry.localizationAccuracy * 100).toFixed(1)}%`,
      `${(entry.validationPassRate * 100).toFixed(1)}%`,
      `${(entry.regressionFreeRate * 100).toFixed(1)}%`,
      `${entry.avgLatencyMs.toFixed(0)} ms`,
      `$${entry.avgCostUsd.toFixed(4)}`
    ])
  });
}

async function persistHealOutput(resultsRoot: string, artifact: HealRunArtifact, report: HealReport): Promise<HealRunResult> {
  const runDir = join(resultsRoot, "runs", artifact.runId);
  const reportsDir = join(resultsRoot, "reports");
  await ensureDir(runDir);
  await ensureDir(reportsDir);

  const artifactPath = join(runDir, "run.json");
  const reportPath = join(reportsDir, `${artifact.runId}.json`);
  const htmlPath = join(reportsDir, `${artifact.runId}.html`);
  await writeJson(artifactPath, artifact);
  await writeJson(reportPath, report);
  await writeText(htmlPath, buildHtml(report));

  return {
    artifact,
    report,
    artifactPath,
    reportPath,
    htmlPath
  };
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function localizationScore(suspectedFiles: string[], goldTouchedFiles: string[]): number {
  if (!goldTouchedFiles.length || !suspectedFiles.length) {
    return 0;
  }
  const gold = new Set(goldTouchedFiles.map(normalizePath));
  const hits = suspectedFiles.map(normalizePath).filter((file) => gold.has(file));
  return round(hits.length / gold.size);
}

function rateFromRuns(taskRuns: TaskRunResult[]): number {
  if (!taskRuns.length) {
    return 0;
  }
  return round(taskRuns.filter((run) => run.success).length / taskRuns.length);
}

function flattenTaskTraces(taskRuns: TaskRunResult[]): OperationTrace[] {
  return taskRuns.flatMap((run) => run.trace);
}

function dedupeSourceCandidates(caseResults: HealCaseTrialResult["findings"]): Array<{
  workspaceRelativePath: string;
  reasons: string[];
}> {
  const merged = new Map<string, Set<string>>();
  for (const finding of caseResults) {
    for (const candidate of finding.sourceCandidates) {
      const current = merged.get(candidate.workspaceRelativePath) ?? new Set<string>();
      for (const reason of candidate.reasons) {
        current.add(reason);
      }
      merged.set(candidate.workspaceRelativePath, current);
    }
  }

  return [...merged.entries()].map(([workspaceRelativePath, reasons]) => ({
    workspaceRelativePath,
    reasons: [...reasons]
  }));
}

function computeModelMetrics(model: ModelAvailability, caseResults: HealCaseTrialResult[]): HealModelMetrics {
  if (!model.available || !caseResults.length) {
    return zeroMetrics(model);
  }

  const localizationAccuracy = round(
    caseResults.reduce((sum, item) => sum + item.localizationScore, 0) / caseResults.length
  );
  const patchApplyRate = round(
    caseResults.filter((item) => item.patchApplied).length / caseResults.length
  );
  const validationPassRate = round(
    caseResults.filter((item) => item.validationPassed).length / caseResults.length
  );
  const failingTaskFixRate = round(
    caseResults.reduce((sum, item) => sum + item.failingTaskFixRate, 0) / caseResults.length
  );
  const regressionFreeRate = round(
    caseResults.reduce((sum, item) => sum + item.regressionFreeRate, 0) / caseResults.length
  );
  const fixRate = round(caseResults.filter((item) => item.fixed).length / caseResults.length);
  const caseLatency = caseResults.map(
    (item) =>
      item.repairUsage.latencyMs +
      item.reproductionRuns.reduce((sum, run) => sum + run.latencyMs, 0) +
      item.postPatchReproductionRuns.reduce((sum, run) => sum + run.latencyMs, 0) +
      item.postPatchRegressionRuns.reduce((sum, run) => sum + run.latencyMs, 0)
  );
  const caseCost = caseResults.map(
    (item) =>
      item.repairUsage.costUsd +
      item.reproductionRuns.reduce((sum, run) => sum + run.costUsd, 0) +
      item.postPatchReproductionRuns.reduce((sum, run) => sum + run.costUsd, 0) +
      item.postPatchRegressionRuns.reduce((sum, run) => sum + run.costUsd, 0)
  );
  const avgLatencyMs = round(caseLatency.reduce((sum, value) => sum + value, 0) / caseLatency.length, 3);
  const avgCostUsd = round(caseCost.reduce((sum, value) => sum + value, 0) / caseCost.length);

  return {
    modelId: model.id,
    localizationAccuracy,
    patchApplyRate,
    validationPassRate,
    failingTaskFixRate,
    regressionFreeRate,
    fixRate,
    avgLatencyMs,
    avgCostUsd,
    score: computeHealScore({
      localizationAccuracy,
      patchApplyRate,
      validationPassRate,
      failingTaskFixRate,
      regressionFreeRate,
      avgLatencyMs,
      avgCostUsd
    })
  };
}

export async function runHealExperiment(input: RunHealExperimentInput): Promise<HealRunResult> {
  await loadProjectEnv();

  const preset = await loadHealPreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const caseIds = preset.caseIds ?? benchmark.benchmark.heal.caseIds;
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveExperimentRoot(resultsDir, "heal");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels = input.models ?? preset.models;
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: HealExperimentSpec = {
    appId: input.appId,
    caseIds,
    models: requestedModels,
    promptId: preset.promptId ?? benchmark.benchmark.prompts.heal,
    trials: input.trials ?? preset.trials ?? benchmark.benchmark.runtime.healTrials,
    runtime: {
      timeoutMs: benchmark.benchmark.runtime.timeoutMs,
      retryCount: benchmark.benchmark.runtime.retryCount,
      maxSteps: benchmark.benchmark.runtime.maxSteps,
      viewport: benchmark.benchmark.runtime.viewport
    },
    resultsDir
  };

  const runId = `heal-${input.appId}-${Date.now()}`;
  const startedAt = nowIso();
  const runner = input.runner ?? new StagehandAutomationRunner();
  const repairClient = input.repairClient ?? new ProviderRepairModelClient();
  const modelSummaries: HealModelSummary[] = [];

  for (const model of models) {
    if (!model.available) {
      modelSummaries.push({
        model,
        metrics: zeroMetrics(model),
        caseResults: []
      });
      continue;
    }

    const caseResults: HealCaseTrialResult[] = [];

    for (const caseId of caseIds) {
      const healCase = benchmark.healCaseMap.get(caseId)!;
      const taskIds = [...new Set([...healCase.reproductionTaskIds, ...healCase.regressionTaskIds])];
      const resolvedSuite = await buildResolvedSuite({
        resolvedBenchmark: benchmark,
        taskIds,
        bugIds: [healCase.bugId],
        explorationMode: "guided",
        suiteId: `${runId}-${caseId}`,
        resultsDir,
        runtime: spec.runtime,
        promptIds: {
          guided: benchmark.benchmark.prompts.qa,
          repair: spec.promptId
        }
      });

      for (let trial = 1; trial <= spec.trials; trial += 1) {
        const attemptId = `${runId}-${caseId}-trial-${trial}`;
        const workspace = await prepareRunWorkspace({
          resolvedSuite,
          runId: attemptId,
          resultsRoot
        });
        let autHandle = await startAut(workspace.aut);

        let reproductionRuns: TaskRunResult[] = [];
        let findings: HealCaseTrialResult["findings"] = [];
        let suspectedFiles: string[] = [];
        let patchGenerated = false;
        let patchApplied = false;
        let validationPassed = false;
        let validationExitCode: number | undefined;
        let note = "repair not attempted";
        let diagnosis: HealCaseTrialResult["diagnosis"];
        let repairUsage = {
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0
        };
        let patchPath: string | undefined;
        let postPatchReproductionRuns: TaskRunResult[] = [];
        let postPatchRegressionRuns: TaskRunResult[] = [];

        try {
          const reproduction = await executeGuidedTasks({
            runId,
            resultsRoot,
            resolvedSuite,
            workspace,
            model,
            runner,
            trial,
            systemPrompt: resolvedSuite.prompts.guided,
            includeFindings: true,
            includeBugHints: false,
            taskIds: healCase.reproductionTaskIds
          });
          reproductionRuns = reproduction.taskRuns;
          findings = reproduction.findings;
          await autHandle?.stop();
          autHandle = undefined;

          if (findings.length === 0) {
            note = "reproduction did not produce benchmark failures";
          } else {
            const candidateFiles = await readCandidateFileSnippets({
              workspacePath: workspace.workspacePath,
              candidates: dedupeSourceCandidates(findings),
              limit: 3
            });
            const traces = flattenTaskTraces(reproductionRuns);
            const repairResult = await repairClient.repair({
              model,
              systemPrompt: resolvedSuite.prompts.repair ?? "Produce the smallest correct patch.",
              context: {
                appId: input.appId,
                findings,
                candidateFiles,
                validationCommand: healCase.validationCommand ?? workspace.validationCommand,
                traces
              }
            });
            diagnosis = repairResult.diagnosis;
            suspectedFiles = repairResult.diagnosis.suspectedFiles;
            patchGenerated = Boolean(repairResult.patch);
            repairUsage = repairResult.usage;

            if (!repairResult.patch) {
              note = "repair model did not return a patch";
            } else {
              const worktreeResult = await withPatchedIsolatedWorktree({
                cwd: workspace.workspacePath,
                patch: repairResult.patch,
                attemptId,
                run: async ({ worktreePath, patchPath: createdPatchPath }) => {
                  const validationCommand = healCase.validationCommand ?? workspace.validationCommand;
                  const validation = await execCommand(validationCommand, { cwd: worktreePath });
                  const rebasedAut = rebaseAutConfig(workspace.aut, workspace.workspacePath, worktreePath);
                  const worktreeWorkspace = {
                    ...workspace,
                    workspacePath: worktreePath,
                    aut: rebasedAut,
                    validationCommand
                  };
                  const aut = await startAut(rebasedAut);
                  try {
                    const reproductionAfterPatch = await executeGuidedTasks({
                      runId,
                      resultsRoot,
                      resolvedSuite,
                      workspace: worktreeWorkspace,
                      model,
                      runner,
                      trial,
                      systemPrompt: resolvedSuite.prompts.guided,
                      taskIds: healCase.reproductionTaskIds
                    });
                    const regressionAfterPatch = await executeGuidedTasks({
                      runId,
                      resultsRoot,
                      resolvedSuite,
                      workspace: worktreeWorkspace,
                      model,
                      runner,
                      trial,
                      systemPrompt: resolvedSuite.prompts.guided,
                      taskIds: healCase.regressionTaskIds
                    });

                    return {
                      validationPassed: validation.exitCode === 0,
                      validationExitCode: validation.exitCode,
                      patchPath: createdPatchPath,
                      note: validation.exitCode === 0 ? "patch applied and validated" : `validation failed: ${validation.stderr || validation.stdout}`,
                      postPatchReproductionRuns: reproductionAfterPatch.taskRuns,
                      postPatchRegressionRuns: regressionAfterPatch.taskRuns
                    };
                  } finally {
                    await aut?.stop();
                  }
                }
              });

              if (!worktreeResult.ok) {
                note = worktreeResult.repair.note;
                patchPath = worktreeResult.repair.patchPath;
              } else {
                patchApplied = true;
                validationPassed = worktreeResult.result.validationPassed;
                validationExitCode = worktreeResult.result.validationExitCode;
                patchPath = worktreeResult.result.patchPath;
                note = worktreeResult.result.note;
                postPatchReproductionRuns = worktreeResult.result.postPatchReproductionRuns;
                postPatchRegressionRuns = worktreeResult.result.postPatchRegressionRuns;
              }
            }
          }
        } finally {
          await autHandle?.stop();
        }

        const failingTaskFixRate = rateFromRuns(postPatchReproductionRuns);
        const regressionFreeRate = rateFromRuns(postPatchRegressionRuns);
        const localization = localizationScore(suspectedFiles, healCase.goldTouchedFiles);
        const fixed = validationPassed && failingTaskFixRate === 1 && regressionFreeRate === 1;

        caseResults.push({
          caseId,
          title: healCase.title,
          trial,
          reproductionRuns,
          findings,
          diagnosis,
          suspectedFiles,
          goldTouchedFiles: healCase.goldTouchedFiles,
          patchGenerated,
          patchApplied,
          validationPassed,
          validationExitCode,
          failingTaskFixRate,
          regressionFreeRate,
          localizationScore: localization,
          fixed,
          repairUsage,
          patchPath,
          note,
          postPatchReproductionRuns,
          postPatchRegressionRuns
        });
      }
    }

    modelSummaries.push({
      model,
      metrics: computeModelMetrics(model, caseResults),
      cacheSummary: summarizeTaskRunCache(
        caseResults.flatMap((caseResult) => [
          ...caseResult.reproductionRuns,
          ...caseResult.postPatchReproductionRuns,
          ...caseResult.postPatchRegressionRuns
        ])
      ),
      caseResults
    });
  }

  const artifact: HealRunArtifact = {
    kind: "heal",
    runId,
    appId: input.appId,
    startedAt,
    finishedAt: nowIso(),
    spec,
    modelSummaries
  };

  return persistHealOutput(resultsRoot, artifact, buildReport(artifact));
}

export async function getHealReport(runId: string, resultsDir = "results"): Promise<HealReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "heal");
  const raw = await readFile(join(reportsRoot, "reports", `${runId}.json`), "utf8");
  return JSON.parse(raw) as HealReport;
}

export async function compareHealRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<HealReport>> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "heal");
  const reports = await Promise.all(runIds.map((runId) => getHealReport(runId, resultsDir)));
  const scoreMap = new Map<string, number[]>();
  for (const report of reports) {
    for (const entry of report.leaderboard) {
      const current = scoreMap.get(entry.modelId) ?? [];
      current.push(entry.score);
      scoreMap.set(entry.modelId, current);
    }
  }

  const aggregateLeaderboard = [...scoreMap.entries()]
    .map(([modelId, scores]) => ({
      modelId,
      avgScore: round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 3),
      runs: scores.length
    }))
    .sort((left, right) => right.avgScore - left.avgScore);

  const html = renderExperimentDashboard({
    title: "Self-Heal Benchmark Comparison",
    subtitle: `Aggregate comparison across ${reports.length} self-heal run(s).`,
    scoreBars: aggregateLeaderboard.map((entry) => ({
      label: entry.modelId,
      value: entry.avgScore,
      max: 100,
      hint: `${entry.runs} run(s)`
    })),
    secondaryCharts: [],
    leaderboardHeaders: ["Model", "Average Score", "Runs"],
    leaderboardRows: aggregateLeaderboard.map((entry) => [entry.modelId, entry.avgScore.toFixed(3), entry.runs])
  });

  const htmlPath = join(reportsRoot, "reports", `compare-${Date.now()}.html`);
  await writeText(htmlPath, html);

  return {
    reports,
    aggregateLeaderboard,
    htmlPath
  };
}
