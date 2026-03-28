import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { formatUsageCost, sumAiUsageSummaries } from "../ai/usage.js";
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
import { renderCostGraphSvg } from "./cost-graph.js";
import { buildHealModelScorecard, screenshotDataUrl, selectHealBaselineRun } from "./report-figures.js";
import { renderPaperReport } from "./report-html.js";
import { computeHealScore } from "./scoring.js";
import type {
  CompareResult,
  CostGraph,
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

function buildHealCostGraph(modelSummaries: HealModelSummary[]): CostGraph {
  return {
    title: "Self-Heal Cost Breakdown",
    caption: "Total self-heal benchmark cost per model, split across reproduction, repair, and post-patch replay.",
    stacked: true,
    series: [
      { key: "reproduce", label: "Reproduce", color: "#b14f43" },
      { key: "repair", label: "Repair", color: "#4d5b7c" },
      { key: "postPatch", label: "Post-Patch Replay", color: "#80935b" }
    ],
    data: modelSummaries.map((summary) => {
      const reproductionUsage = sumAiUsageSummaries(summary.caseResults.map((caseResult) => caseResult.reproductionUsage));
      const repairUsage = sumAiUsageSummaries(summary.caseResults.map((caseResult) => caseResult.repairUsage));
      const postPatchUsage = sumAiUsageSummaries(summary.caseResults.map((caseResult) => caseResult.postPatchUsage));
      const totalUsage = sumAiUsageSummaries([reproductionUsage, repairUsage, postPatchUsage]);
      return {
        modelId: summary.model.id,
        provider: summary.model.provider,
        values: {
          reproduce: reproductionUsage.costUsd ?? 0,
          repair: repairUsage.costUsd ?? 0,
          postPatch: postPatchUsage.costUsd ?? 0
        },
        totalUsd: totalUsage.costUsd,
        costSource: totalUsage.costSource,
        note: totalUsage.costSource === "unavailable" ? "One or more repair pipeline calls did not resolve an exact gateway cost." : undefined
      };
    })
  };
}

function buildReport(artifact: HealRunArtifact): HealReport {
  return {
    kind: "heal",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard: buildLeaderboard(artifact.modelSummaries),
    modelSummaries: artifact.modelSummaries,
    costGraph: buildHealCostGraph(artifact.modelSummaries)
  };
}

function buildHtml(report: HealReport): string {
  const orderedSummaries = [...report.modelSummaries].sort((left, right) => {
    const leftRank = report.leaderboard.find((entry) => entry.modelId === left.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = report.leaderboard.find((entry) => entry.modelId === right.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const baselineRun = selectHealBaselineRun(report);
  const topModel = report.leaderboard[0];

  return renderPaperReport({
    title: `${report.appId} Self-Heal Report`,
    subtitle: `Repair quality across ${report.leaderboard.length} model(s).`,
    abstract: topModel
      ? `${topModel.modelId} ranked first in self-heal mode with a score of ${topModel.score.toFixed(3)}, achieving ${(topModel.fixRate * 100).toFixed(1)}% fix rate and ${(topModel.validationPassRate * 100).toFixed(1)}% validation pass rate.`
      : "Self-heal mode summarizes diagnosis, patching, and validation quality across seeded bug cases.",
    meta: [
      { label: "Run ID", value: report.runId },
      { label: "App", value: report.appId },
      { label: "Prompt", value: report.spec.promptId },
      { label: "Trials", value: String(report.spec.trials) },
      { label: "Models", value: String(report.leaderboard.length) },
      { label: "Generated", value: report.generatedAt }
    ],
    sections: [
      {
        title: "Experiment Setup",
        body: [
          "Self-heal mode measures diagnosis, patch generation, patch application, and regression-safe validation across the seeded benchmark bugs."
        ],
        facts: [
          { label: "Cases", value: String(report.spec.caseIds.length) },
          { label: "Timeout", value: `${report.spec.runtime.timeoutMs} ms` },
          { label: "Viewport", value: `${report.spec.runtime.viewport.width} × ${report.spec.runtime.viewport.height}` },
          { label: "Retry Count", value: String(report.spec.runtime.retryCount) }
        ]
      }
    ],
    figure: {
      title: "Unified Self-Heal Figure",
      caption: "Baseline application state plus one heal summary scorecard per model.",
      panels: [
        {
          label: "A",
          title: "Test App Baseline",
          subtitle: baselineRun?.taskId ?? "No baseline reproduction screenshot",
          imageDataUrl: screenshotDataUrl(baselineRun?.screenshotBase64),
          imageAlt: "Baseline self-heal application screenshot",
          metrics: baselineRun
            ? [
                { label: "Source Task", value: baselineRun.taskId },
                { label: "Outcome", value: baselineRun.success ? "Passed" : "Observed" }
              ]
            : [],
          caption: baselineRun
            ? "Baseline application state selected from the first available reproduction or smoke screenshot."
            : "No self-heal reproduction screenshot was available in this run."
        },
        ...orderedSummaries.map((summary, index) => {
          const scorecard = buildHealModelScorecard(summary);
          return {
            label: String.fromCharCode(66 + index),
            title: summary.model.id,
            subtitle: "Model repair summary",
            metrics: [
              { label: "Score", value: summary.metrics.score.toFixed(3) },
              { label: "Fix Rate", value: `${(summary.metrics.fixRate * 100).toFixed(1)}%` },
              { label: "Localization", value: `${(summary.metrics.localizationAccuracy * 100).toFixed(1)}%` },
              { label: "Validation", value: `${(summary.metrics.validationPassRate * 100).toFixed(1)}%` },
              { label: "Regression-Free", value: `${(summary.metrics.regressionFreeRate * 100).toFixed(1)}%` },
              { label: "Latency", value: `${summary.metrics.avgLatencyMs.toFixed(0)} ms` },
              { label: "Cost", value: `$${summary.metrics.avgCostUsd.toFixed(4)}` }
            ],
            badges: [...scorecard.badges, ...scorecard.caseBadges],
            caption: "Overall repair scorecard with compact per-case status badges."
          };
        })
      ]
    },
    charts: [
      {
        title: report.costGraph.title,
        caption: report.costGraph.caption,
        svgMarkup: renderCostGraphSvg(report.costGraph),
        note: report.costGraph.data.some((datum) => datum.costSource === "unavailable")
          ? "Models marked unavailable encountered at least one reproduce, repair, or post-patch replay call without an exact gateway lookup."
          : undefined
      }
    ],
    tables: [
      {
        title: "Quantitative Results",
        columns: ["Rank", "Model", "Score", "Fix", "Localize", "Validate", "Regression", "Latency", "Cost"],
        rows: report.leaderboard.map((entry) => [
          String(entry.rank),
          entry.modelId,
          entry.score.toFixed(3),
          `${(entry.fixRate * 100).toFixed(1)}%`,
          `${(entry.localizationAccuracy * 100).toFixed(1)}%`,
          `${(entry.validationPassRate * 100).toFixed(1)}%`,
          `${(entry.regressionFreeRate * 100).toFixed(1)}%`,
          `${entry.avgLatencyMs.toFixed(0)} ms`,
          `$${entry.avgCostUsd.toFixed(4)}`
        ])
      },
      {
        title: "Self-Heal Cost Audit",
        columns: ["Model", "Case", "Trial", "Reproduce", "Repair", "Post-Patch", "Total"],
        rows: orderedSummaries.flatMap((summary) =>
          summary.caseResults.map((caseResult) => [
            summary.model.id,
            caseResult.title,
            String(caseResult.trial),
            formatUsageCost(caseResult.reproductionUsage),
            formatUsageCost(caseResult.repairUsage),
            formatUsageCost(caseResult.postPatchUsage),
            formatUsageCost(caseResult.totalUsage)
          ])
        )
      }
    ],
    appendix: orderedSummaries.flatMap((summary) =>
      summary.caseResults.map((caseResult) => ({
        title: `${summary.model.id} · ${caseResult.title}`,
        body: [
          caseResult.diagnosis?.summary ?? caseResult.note,
          `Patch ${caseResult.patchApplied ? "applied" : "did not apply"} and validation ${caseResult.validationPassed ? "passed" : "failed"}.`
        ],
        facts: [
          { label: "Trial", value: String(caseResult.trial) },
          { label: "Fix Rate", value: `${(caseResult.failingTaskFixRate * 100).toFixed(1)}%` },
          { label: "Regression-Free", value: `${(caseResult.regressionFreeRate * 100).toFixed(1)}%` },
          { label: "Localization", value: caseResult.localizationScore.toFixed(3) }
        ],
        badges: [
          caseResult.patchGenerated ? "Patch generated" : "No patch",
          caseResult.patchApplied ? "Patch applied" : "Patch not applied",
          caseResult.validationPassed ? "Validation passed" : "Validation failed",
          caseResult.fixed ? "Case fixed" : "Case not fixed"
        ]
      }))
    )
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
  const caseLatency = caseResults.map((item) => item.totalUsage?.latencyMs ?? 0);
  const caseCost = caseResults.map((item) => item.totalUsage?.costUsd ?? 0);
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
        let repairUsage: HealCaseTrialResult["repairUsage"] = {
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          resolvedCostUsd: 0,
          costSource: "exact" as const,
          callCount: 0,
          unavailableCalls: 0
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
            usagePhase: "reproduction",
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
                      usagePhase: "post_patch_replay",
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
                      usagePhase: "post_patch_replay",
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
        const reproductionUsage = sumAiUsageSummaries(reproductionRuns.map((run) => run.usageSummary));
        const postPatchUsage = sumAiUsageSummaries(
          [...postPatchReproductionRuns, ...postPatchRegressionRuns].map((run) => run.usageSummary)
        );
        const totalUsage = sumAiUsageSummaries([reproductionUsage, repairUsage, postPatchUsage]);

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
          reproductionUsage,
          postPatchUsage,
          totalUsage,
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

  const html = renderPaperReport({
    title: "Self-Heal Comparison",
    subtitle: `Aggregate comparison across ${reports.length} self-heal run(s).`,
    abstract:
      aggregateLeaderboard[0]
        ? `${aggregateLeaderboard[0].modelId} achieved the highest mean self-heal score across ${reports.length} run(s), with an average score of ${aggregateLeaderboard[0].avgScore.toFixed(3)}.`
        : "Aggregate self-heal comparison across benchmark runs.",
    meta: [
      { label: "Runs Compared", value: String(reports.length) },
      { label: "Models Compared", value: String(aggregateLeaderboard.length) }
    ],
    sections: [
      {
        title: "Experiment Setup",
        body: ["This aggregate page summarizes average self-heal scores across previously generated run reports."]
      }
    ],
    figure: {
      title: "Aggregate Score Figure",
      caption: "Average self-heal score per model across the selected run set.",
      panels: aggregateLeaderboard.map((entry, index) => ({
        label: String.fromCharCode(65 + index),
        title: entry.modelId,
        metrics: [
          { label: "Average Score", value: entry.avgScore.toFixed(3) },
          { label: "Runs", value: String(entry.runs) }
        ],
        caption: "Scorecard summary for the aggregate comparison."
      }))
    },
    tables: [
      {
        title: "Aggregate Results Table",
        columns: ["Model", "Average Score", "Runs"],
        rows: aggregateLeaderboard.map((entry) => [entry.modelId, entry.avgScore.toFixed(3), String(entry.runs)])
      }
    ],
    appendix: [
      {
        title: "Included Run IDs",
        badges: reports.map((report) => report.runId)
      }
    ]
  });

  const htmlPath = join(reportsRoot, "reports", `compare-${Date.now()}.html`);
  await writeText(htmlPath, html);

  return {
    reports,
    aggregateLeaderboard,
    htmlPath
  };
}
