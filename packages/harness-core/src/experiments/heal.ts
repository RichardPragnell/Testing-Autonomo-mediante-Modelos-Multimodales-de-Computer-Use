import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { AutomationRunner, ModelAvailability, OperationTrace, ScenarioRunResult } from "../types.js";
import { summarizeScenarioRunCache } from "../cache/summary.js";
import { loadModelRegistry, resolveModelAvailability } from "../config/model-registry.js";
import { loadProjectEnv } from "../env/load.js";
import { StagehandAutomationRunner } from "../runner/stagehand-runner.js";
import { prepareRunWorkspace } from "../runtime/workspace.js";
import { startAut } from "../runtime/aut.js";
import { OpenRouterRepairModelClient, type RepairModelClient } from "../self-heal/model-client.js";
import { rebaseAutConfig, withPatchedIsolatedWorktree } from "../self-heal/worktree.js";
import { execCommand } from "../utils/exec.js";
import { nowIso } from "../utils/time.js";
import { ensureDir, resolveWorkspacePath, writeJson, writeText } from "../utils/fs.js";
import { loadAppBenchmark } from "./benchmark.js";
import {
  aggregateModeSection,
  buildAggregateLeaderboard,
  removeComparisonReports,
  persistComparisonReport
} from "./comparison.js";
import {
  buildResolvedSuite,
  emitExperimentLog,
  executeGuidedScenarios,
  formatDurationMs,
  mapWithConcurrency,
  readCandidateFileSnippets,
  resolveExperimentRoot,
  resolveParallelism,
  round
} from "./common.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { formatCostSummary } from "./report-utils.js";
import { computeHealScore, HEAL_SCORE_DEFINITION } from "./scoring.js";
import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn,
  CompareResult,
  CostGraph,
  HealCaseTrialResult,
  HealExperimentSpec,
  HealLeaderboardEntry,
  HealModelMetrics,
  HealModelSummary,
  HealReport,
  HealRunArtifact,
  HealRunResult,
  ModeComparisonBuildResult
} from "./types.js";
import type { ExperimentLogFn } from "./types.js";

const healPresetSchema = z
  .object({
    caseIds: z.array(z.string()).optional(),
    promptId: z.string().optional(),
    trials: z.number().int().min(1).optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough();

const HEAL_METRIC_COLUMNS: BenchmarkMetricColumn[] = [
  { key: "score", label: "Score", kind: "score", aggregate: "mean" },
  { key: "fixRate", label: "Fix Rate", kind: "percent", aggregate: "mean" },
  { key: "failingScenarioFix", label: "Failing-Scenario Fix", kind: "percent", aggregate: "mean" },
  { key: "regressionFree", label: "Regression-Free", kind: "percent", aggregate: "mean" },
  { key: "validationPass", label: "Validation Pass", kind: "percent", aggregate: "mean" },
  { key: "localization", label: "Localization Recall", kind: "percent", aggregate: "mean" },
  { key: "patchApply", label: "Patch Apply", kind: "percent", aggregate: "mean" },
  { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

export interface RunHealExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  parallelism?: number;
  resultsDir?: string;
  resetModeResults?: boolean;
  runner?: AutomationRunner;
  repairClient?: RepairModelClient;
  onLog?: ExperimentLogFn;
}

async function loadHealPreset(pathLike?: string): Promise<z.infer<typeof healPresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return healPresetSchema.parse(JSON.parse(raw));
}

async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function clearHealOutputs(resultsDir: string): Promise<void> {
  const workspaceRoot = await resolveWorkspacePath(resultsDir);
  await Promise.all([
    removePathIfExists(join(workspaceRoot, "heal", "runs")),
    removePathIfExists(join(workspaceRoot, "heal", "reports")),
    removeComparisonReports(resultsDir, ["heal-compare", "benchmark-compare"])
  ]);
}

function zeroMetrics(model: ModelAvailability): HealModelMetrics {
  return {
    modelId: model.id,
    localizationAccuracy: 0,
    patchApplyRate: 0,
    validationPassRate: 0,
    failingScenarioFixRate: 0,
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
    .map((summary, index) => {
      const costSummary = summarizeUsageCosts(summary.caseResults.map((caseResult) => caseResult.totalUsage), summary.caseResults.length);
      return {
        rank: index + 1,
        modelId: summary.model.id,
        provider: summary.model.provider,
        score: summary.metrics.score,
        localizationAccuracy: summary.metrics.localizationAccuracy,
        patchApplyRate: summary.metrics.patchApplyRate,
        validationPassRate: summary.metrics.validationPassRate,
        failingScenarioFixRate: summary.metrics.failingScenarioFixRate,
        regressionFreeRate: summary.metrics.regressionFreeRate,
        fixRate: summary.metrics.fixRate,
        avgLatencyMs: summary.metrics.avgLatencyMs,
        avgCostUsd: costSummary.avgResolvedUsd,
        costSummary
      };
    });
}

function buildHealCostGraph(modelSummaries: HealModelSummary[]): CostGraph {
  return {
    title: "Self-Heal Cost Breakdown",
    caption: "Resolved self-heal spend per model, split across reproduction, repair, and post-patch replay.",
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
      const costSummary = summarizeUsageCosts(summary.caseResults.map((caseResult) => caseResult.totalUsage), summary.caseResults.length);
      return {
        modelId: summary.model.id,
        provider: summary.model.provider,
        values: {
          reproduce: reproductionUsage.resolvedCostUsd ?? reproductionUsage.costUsd ?? 0,
          repair: repairUsage.resolvedCostUsd ?? repairUsage.costUsd ?? 0,
          postPatch: postPatchUsage.resolvedCostUsd ?? postPatchUsage.costUsd ?? 0
        },
        totalUsd: costSummary.totalResolvedUsd,
        costSource: costSummary.costSource,
        callCount: costSummary.callCount,
        note:
          costSummary.callCount === 0
            ? "No AI calls were required for this run."
            : costSummary.costSource === "unavailable"
              ? "One or more reproduce, repair, or replay calls lacked exact provider usage."
              : undefined
      };
    })
  };
}

function buildHealSection(input: {
  appId: string;
  runId: string;
  leaderboard: HealLeaderboardEntry[];
}): BenchmarkComparisonSection {
  const topModel = input.leaderboard[0];
  return {
    kind: "heal",
    title: "Self-Heal",
    summary: topModel
      ? `${topModel.modelId} leads self-heal mode with ${topModel.score.toFixed(3)} score, ${(topModel.fixRate * 100).toFixed(1)}% fix rate, and total cost ${formatCostSummary(topModel.costSummary, "totalResolvedUsd")}.`
      : "No self-heal results were available.",
    appIds: [input.appId],
    metricColumns: HEAL_METRIC_COLUMNS,
    scoreDefinition: HEAL_SCORE_DEFINITION,
    rows: input.leaderboard.map((entry) => ({
      modelId: entry.modelId,
      provider: entry.provider,
      avgScore: entry.score,
      cells: [
        {
          appId: input.appId,
          runIds: [input.runId],
          metrics: {
            score: entry.score,
            fixRate: entry.fixRate,
            failingScenarioFix: entry.failingScenarioFixRate,
            regressionFree: entry.regressionFreeRate,
            validationPass: entry.validationPassRate,
            localization: entry.localizationAccuracy,
            patchApply: entry.patchApplyRate,
            avgLatency: entry.avgLatencyMs,
            avgCost: entry.costSummary.avgResolvedUsd,
            totalCost: entry.costSummary.totalResolvedUsd
          },
          costSummary: entry.costSummary
        }
      ]
    })),
    notes: [
      "Score is shown on a 0-100 scale where higher is better.",
      "Fix Rate is the primary self-heal outcome, followed by failing-scenario repair quality and regression control.",
      "Patch Apply remains visible as an operational metric, but it no longer contributes to the weighted score.",
      "Total Cost sums resolved self-heal spend across the full run."
    ],
    audit: {
      title: "Self-Heal Cost Audit",
      columns: ["Model", "Total Cost"],
      rows: input.leaderboard.map((entry) => [
        entry.modelId,
        formatCostSummary(entry.costSummary, "totalResolvedUsd")
      ])
    }
  };
}

function buildReport(artifact: HealRunArtifact): HealReport {
  const leaderboard = buildLeaderboard(artifact.modelSummaries);
  return {
    kind: "heal",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard,
    modelSummaries: artifact.modelSummaries,
    costGraph: buildHealCostGraph(artifact.modelSummaries),
    section: buildHealSection({
      appId: artifact.appId,
      runId: artifact.runId,
      leaderboard
    })
  };
}

function buildHtml(report: HealReport): string {
  const htmlReport: BenchmarkComparisonReport = {
    title: `${report.appId} Self-Heal Report`,
    subtitle: `Matrix summary for repair evaluation across ${report.section.rows.length} model(s).`,
    generatedAt: report.generatedAt,
    runIds: [report.runId],
    appIds: [report.appId],
    modeSections: [report.section],
    finalReportPath: "",
    finalJsonPath: ""
  };
  return renderBenchmarkComparisonHtml(htmlReport);
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
  await writeJson(reportPath, {
    kind: report.kind,
    runId: report.runId,
    appId: report.appId,
    generatedAt: report.generatedAt,
    section: report.section
  });
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

function rateFromRuns(scenarioRuns: ScenarioRunResult[]): number {
  if (!scenarioRuns.length) {
    return 0;
  }
  return round(scenarioRuns.filter((run) => run.success).length / scenarioRuns.length);
}

function flattenScenarioTraces(scenarioRuns: ScenarioRunResult[]): OperationTrace[] {
  return scenarioRuns.flatMap((run) => run.trace);
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

  const localizationAccuracy = round(caseResults.reduce((sum, item) => sum + item.localizationScore, 0) / caseResults.length);
  const patchApplyRate = round(caseResults.filter((item) => item.patchApplied).length / caseResults.length);
  const validationPassRate = round(caseResults.filter((item) => item.validationPassed).length / caseResults.length);
  const failingScenarioFixRate = round(caseResults.reduce((sum, item) => sum + item.failingScenarioFixRate, 0) / caseResults.length);
  const regressionFreeRate = round(caseResults.reduce((sum, item) => sum + item.regressionFreeRate, 0) / caseResults.length);
  const fixRate = round(caseResults.filter((item) => item.fixed).length / caseResults.length);
  const totalUsage = sumAiUsageSummaries(caseResults.map((item) => item.totalUsage));
  const costSummary = summarizeUsageCosts(caseResults.map((item) => item.totalUsage), caseResults.length);
  const avgLatencyMs = round(totalUsage.latencyMs / caseResults.length, 3);

  return {
    modelId: model.id,
    localizationAccuracy,
    patchApplyRate,
    validationPassRate,
    failingScenarioFixRate,
    regressionFreeRate,
    fixRate,
    avgLatencyMs,
    avgCostUsd: costSummary.avgResolvedUsd,
    score: computeHealScore({
      fixRate,
      localizationAccuracy,
      patchApplyRate,
      validationPassRate,
      failingScenarioFixRate,
      regressionFreeRate,
      avgLatencyMs,
      avgCostUsd: costSummary.avgResolvedUsd
    })
  };
}

export async function runHealExperiment(input: RunHealExperimentInput): Promise<HealRunResult> {
  await loadProjectEnv();
  const runStartedAtMs = Date.now();

  const preset = await loadHealPreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const caseIds = preset.caseIds ?? benchmark.benchmark.heal.caseIds;
  const resultsDir = input.resultsDir ?? "results";
  if (input.resetModeResults !== false) {
    await clearHealOutputs(resultsDir);
  }
  const resultsRoot = await resolveExperimentRoot(resultsDir, "heal");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels =
    input.models ?? preset.models ?? registry.models.filter((model) => model.enabled).map((model) => model.id);
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
  const parallelism = resolveParallelism(input.parallelism);
  const startedAt = nowIso();
  emitExperimentLog(
    input.onLog,
    `[heal] Starting ${runId} for ${input.appId}: ${models.length} model(s), ${caseIds.length} case(s), ${spec.trials} trial(s), model parallelism ${parallelism}`
  );
  const runner = input.runner ?? new StagehandAutomationRunner();
  const repairClient = input.repairClient ?? new OpenRouterRepairModelClient();
  const modelSummaries = await mapWithConcurrency(models, parallelism, async (model, modelIndex) => {
    if (!model.available) {
      emitExperimentLog(
        input.onLog,
        `[heal] Skipping model ${modelIndex + 1}/${models.length} ${model.id}: ${model.reason ?? "unavailable"}`
      );
      return {
        model,
        metrics: zeroMetrics(model),
        caseResults: []
      } satisfies HealModelSummary;
    }

    const caseResults: HealCaseTrialResult[] = [];
    emitExperimentLog(input.onLog, `[heal] Model ${modelIndex + 1}/${models.length}: ${model.id} started`);

    for (const [caseIndex, caseId] of caseIds.entries()) {
      const healCase = benchmark.healCaseMap.get(caseId)!;
      emitExperimentLog(
        input.onLog,
        `[heal] Case ${caseIndex + 1}/${caseIds.length} ${caseId} (${healCase.bugId}) for ${model.id} started`
      );
      const scenarioIds = [...new Set([...healCase.reproductionScenarioIds, ...healCase.regressionScenarioIds])];
      const resolvedSuite = await buildResolvedSuite({
        resolvedBenchmark: benchmark,
        scenarioIds,
        bugIds: [healCase.bugId],
        explorationMode: "guided",
        suiteId: `${runId}-${caseId}`,
        resultsDir,
        runtime: spec.runtime,
        promptIds: {
          guided: benchmark.benchmark.prompts.guided,
          repair: spec.promptId
        }
      });

      for (let trial = 1; trial <= spec.trials; trial += 1) {
        const attemptId = `${runId}-${caseId}-trial-${trial}-model-${modelIndex + 1}`;
        emitExperimentLog(input.onLog, `[heal] Case ${caseId} trial ${trial}/${spec.trials}: reproduction started`);
        const workspace = await prepareRunWorkspace({
          resolvedSuite,
          runId: attemptId,
          resultsRoot
        });
        let autHandle: Awaited<ReturnType<typeof startAut>> | undefined;

        let reproductionRuns: ScenarioRunResult[] = [];
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
        let postPatchReproductionRuns: ScenarioRunResult[] = [];
        let postPatchRegressionRuns: ScenarioRunResult[] = [];

        try {
          autHandle = await startAut(workspace.aut);
          const reproduction = await executeGuidedScenarios({
            runId: attemptId,
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
            scenarioIds: healCase.reproductionScenarioIds,
            onLog: input.onLog,
            scenarioLabel: `[heal][${model.id}][${caseId}][trial ${trial}] reproduction scenario`
          });
          reproductionRuns = reproduction.scenarioRuns;
          findings = reproduction.findings;
          emitExperimentLog(
            input.onLog,
            `[heal] Case ${caseId} trial ${trial}/${spec.trials}: reproduction produced ${findings.length} finding(s)`
          );
          await autHandle?.stop();
          autHandle = undefined;

          if (findings.length === 0) {
            note = "reproduction did not produce benchmark failures";
            emitExperimentLog(input.onLog, `[heal] Case ${caseId} trial ${trial}/${spec.trials}: ${note}`);
          } else {
            const candidateFiles = await readCandidateFileSnippets({
              workspacePath: workspace.workspacePath,
              candidates: dedupeSourceCandidates(findings),
              limit: 3
            });
            const traces = flattenScenarioTraces(reproductionRuns);
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
            emitExperimentLog(
              input.onLog,
              `[heal] Case ${caseId} trial ${trial}/${spec.trials}: repair diagnosis targeted ${suspectedFiles.length} file(s) and ${patchGenerated ? "returned a patch" : "did not return a patch"}`
            );

            if (!repairResult.patch) {
              note = "repair model did not return a patch";
              emitExperimentLog(input.onLog, `[heal] Case ${caseId} trial ${trial}/${spec.trials}: ${note}`);
            } else {
              emitExperimentLog(input.onLog, `[heal] Case ${caseId} trial ${trial}/${spec.trials}: validating patched worktree`);
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
                    const reproductionAfterPatch = await executeGuidedScenarios({
                      runId: `${attemptId}-post-patch`,
                      resultsRoot,
                      resolvedSuite,
                      workspace: worktreeWorkspace,
                      model,
                      runner,
                      trial,
                      usagePhase: "post_patch_replay",
                      systemPrompt: resolvedSuite.prompts.guided,
                      scenarioIds: healCase.reproductionScenarioIds,
                      onLog: input.onLog,
                      scenarioLabel: `[heal][${model.id}][${caseId}][trial ${trial}] post-patch reproduction scenario`
                    });
                    const regressionAfterPatch = await executeGuidedScenarios({
                      runId: `${attemptId}-post-patch`,
                      resultsRoot,
                      resolvedSuite,
                      workspace: worktreeWorkspace,
                      model,
                      runner,
                      trial,
                      usagePhase: "post_patch_replay",
                      systemPrompt: resolvedSuite.prompts.guided,
                      scenarioIds: healCase.regressionScenarioIds,
                      onLog: input.onLog,
                      scenarioLabel: `[heal][${model.id}][${caseId}][trial ${trial}] post-patch regression scenario`
                    });

                    return {
                      validationPassed: validation.exitCode === 0,
                      validationExitCode: validation.exitCode,
                      patchPath: createdPatchPath,
                      note: validation.exitCode === 0 ? "patch applied and validated" : `validation failed: ${validation.stderr || validation.stdout}`,
                      postPatchReproductionRuns: reproductionAfterPatch.scenarioRuns,
                      postPatchRegressionRuns: regressionAfterPatch.scenarioRuns
                    };
                  } finally {
                    await aut?.stop();
                  }
                }
              });

              if (!worktreeResult.ok) {
                note = worktreeResult.repair.note;
                patchPath = worktreeResult.repair.patchPath;
                emitExperimentLog(input.onLog, `[heal] Case ${caseId} trial ${trial}/${spec.trials}: ${note}`);
              } else {
                patchApplied = true;
                validationPassed = worktreeResult.result.validationPassed;
                validationExitCode = worktreeResult.result.validationExitCode;
                patchPath = worktreeResult.result.patchPath;
                note = worktreeResult.result.note;
                postPatchReproductionRuns = worktreeResult.result.postPatchReproductionRuns;
                postPatchRegressionRuns = worktreeResult.result.postPatchRegressionRuns;
                emitExperimentLog(
                  input.onLog,
                  `[heal] Case ${caseId} trial ${trial}/${spec.trials}: ${note}; post-patch reproduction ${postPatchReproductionRuns.filter((run) => run.success).length}/${postPatchReproductionRuns.length}, regression ${postPatchRegressionRuns.filter((run) => run.success).length}/${postPatchRegressionRuns.length}`
                );
              }
            }
          }
        } finally {
          await autHandle?.stop();
        }

        const failingScenarioFixRate = rateFromRuns(postPatchReproductionRuns);
        const regressionFreeRate = rateFromRuns(postPatchRegressionRuns);
        const localization = localizationScore(suspectedFiles, healCase.goldTouchedFiles);
        const fixed = validationPassed && failingScenarioFixRate === 1 && regressionFreeRate === 1;
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
          failingScenarioFixRate,
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
        emitExperimentLog(
          input.onLog,
          `[heal] Case ${caseId} trial ${trial}/${spec.trials} completed: fixed=${fixed ? "yes" : "no"}, failing-scenario ${(failingScenarioFixRate * 100).toFixed(1)}%, regression-free ${(regressionFreeRate * 100).toFixed(1)}%`
        );
      }
    }

    const metrics = computeModelMetrics(model, caseResults);
    const summary = {
      model,
      metrics,
      cacheSummary: summarizeScenarioRunCache(
        caseResults.flatMap((caseResult) => [
          ...caseResult.reproductionRuns,
          ...caseResult.postPatchReproductionRuns,
          ...caseResult.postPatchRegressionRuns
        ])
      ),
      caseResults
    } satisfies HealModelSummary;
    emitExperimentLog(
      input.onLog,
      `[heal] Model ${model.id} completed: score ${metrics.score.toFixed(3)}, fix rate ${(metrics.fixRate * 100).toFixed(1)}%, regression-free ${(metrics.regressionFreeRate * 100).toFixed(1)}%`
    );
    return summary;
  });

  const artifact: HealRunArtifact = {
    kind: "heal",
    runId,
    appId: input.appId,
    startedAt,
    finishedAt: nowIso(),
    spec,
    modelSummaries
  };

  const output = await persistHealOutput(resultsRoot, artifact, buildReport(artifact));
  emitExperimentLog(
    input.onLog,
    `[heal] Completed ${runId} in ${formatDurationMs(Date.now() - runStartedAtMs)}. Report: ${output.reportPath}`
  );
  return output;
}

export async function getHealReport(runId: string, resultsDir = "results"): Promise<HealReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "heal");
  const raw = await readFile(join(reportsRoot, "runs", runId, "run.json"), "utf8");
  return buildReport(JSON.parse(raw) as HealRunArtifact);
}

export function buildHealComparison(reports: Array<{ section: BenchmarkComparisonSection }>): ModeComparisonBuildResult {
  const initialSection = aggregateModeSection(
    reports.map((report) => report.section),
    `Self-heal matrix across ${reports.length} run(s).`
  );
  const aggregateLeaderboard = buildAggregateLeaderboard(initialSection);
  const topModel = aggregateLeaderboard[0];
  const modeSection: BenchmarkComparisonSection = {
    ...initialSection,
    summary: topModel
      ? `${topModel.modelId} leads self-heal comparison with ${topModel.avgScore.toFixed(3)} average score across ${topModel.runs} run(s).`
      : initialSection.summary
  };

  return {
    aggregateLeaderboard,
    modeSection
  };
}

export async function compareHealRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<HealReport>> {
  const reports = await Promise.all(runIds.map((runId) => getHealReport(runId, resultsDir)));
  const { aggregateLeaderboard, modeSection } = buildHealComparison(reports);
  const finalReport = await persistComparisonReport({
    title: "Self-Heal Comparison",
    subtitle: `Matrix comparison across ${reports.length} self-heal run(s).`,
    runIds,
    modeSections: [modeSection],
    resultsDir,
    prefix: "heal-compare",
    stableName: "heal-compare-latest"
  });

  return {
    kind: "heal",
    reports,
    aggregateLeaderboard,
    modeSection,
    finalReportPath: finalReport.finalReportPath,
    finalJsonPath: finalReport.finalJsonPath
  };
}
