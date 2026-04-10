import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { AutomationRunner, ModelAvailability, ScenarioRunResult } from "../types.js";
import { loadModelRegistry, resolveModelAvailability } from "../config/model-registry.js";
import { loadProjectEnv } from "../env/load.js";
import { StagehandAutomationRunner } from "../runner/stagehand-runner.js";
import { prepareRunWorkspace } from "../runtime/workspace.js";
import { startAut } from "../runtime/aut.js";
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
  resolveExperimentRoot,
  resolveParallelism,
  round,
  summarizeScenarioRuns
} from "./common.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { formatCostSummary } from "./report-utils.js";
import { computeQaScore, QA_SCORE_DEFINITION } from "./scoring.js";
import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn,
  CompareResult,
  CostGraph,
  ModeComparisonBuildResult,
  QaExperimentSpec,
  QaLeaderboardEntry,
  QaModelMetrics,
  QaModelSummary,
  QaReport,
  QaRunArtifact,
  QaRunResult
} from "./types.js";
import type { ExperimentLogFn } from "./types.js";

const GUIDED_RUNTIME_DEFAULTS = {
  profile: "full",
  maxOutputTokens: 600
} as const;

const qaPresetSchema = z
  .object({
    capabilityIds: z.array(z.string()).optional(),
    promptId: z.string().optional(),
    trials: z.number().int().min(1).optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough();

const QA_METRIC_COLUMNS: BenchmarkMetricColumn[] = [
  { key: "score", label: "Score", kind: "score", aggregate: "mean" },
  { key: "stepPassRate", label: "Step Pass", kind: "percent", aggregate: "mean" },
  { key: "scenarioCompletion", label: "Scenario Completion", kind: "percent", aggregate: "mean" },
  { key: "capabilityPassRate", label: "Capability Pass", kind: "percent", aggregate: "mean" },
  { key: "stability", label: "Stability", kind: "score", aggregate: "mean" },
  { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

export interface RunQaExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  timeoutMs?: number;
  retryCount?: number;
  maxSteps?: number;
  maxOutputTokens?: number;
  viewport?: {
    width: number;
    height: number;
  };
  parallelism?: number;
  resultsDir?: string;
  resetModeResults?: boolean;
  runner?: AutomationRunner;
  onLog?: ExperimentLogFn;
}

async function loadQaPreset(pathLike?: string): Promise<z.infer<typeof qaPresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return qaPresetSchema.parse(JSON.parse(raw));
}

async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function clearQaOutputs(resultsDir: string): Promise<void> {
  const guidedRoot = await resolveExperimentRoot(resultsDir, "qa");
  await Promise.all([
    removePathIfExists(join(guidedRoot, "runs")),
    removePathIfExists(join(guidedRoot, "reports")),
    removeComparisonReports(resultsDir, ["guided-compare", "qa-compare", "benchmark-compare"])
  ]);
}

function slimScenarioRunForProgress(run: ScenarioRunResult) {
  return {
    scenarioId: run.scenarioId,
    trial: run.trial,
    modelId: run.modelId,
    success: run.success,
    message: run.message,
    latencyMs: run.latencyMs,
    usageSummary: run.usageSummary,
    cache: run.cache,
    error: run.error
  };
}

async function persistQaProgress(
  resultsRoot: string,
  runId: string,
  progress: {
    appId: string;
    profile: QaExperimentSpec["profile"];
    status: "running" | "completed";
    startedAt: string;
    updatedAt: string;
    models: string[];
    trials: number;
    currentModelId?: string;
    currentTrial?: number;
    currentScenarioIndex?: number;
    currentScenarioId?: string;
    completedScenarios: number;
    totalScenarios: number;
    cumulativeUsage: ReturnType<typeof sumAiUsageSummaries>;
    lastScenarioResult?: ReturnType<typeof slimScenarioRunForProgress>;
  }
): Promise<void> {
  const runDir = join(resultsRoot, "runs", runId);
  await ensureDir(runDir);
  await writeJson(join(runDir, "progress.json"), progress);
}

function createProgressWriter<TProgress>(writer: (progress: TProgress) => Promise<void>) {
  let queued = Promise.resolve();
  return async (progress: TProgress): Promise<void> => {
    queued = queued.then(() => writer(progress));
    await queued;
  };
}

function zeroMetrics(model: ModelAvailability): QaModelMetrics {
  return {
    modelId: model.id,
    capabilityPassRate: 0,
    scenarioCompletionRate: 0,
    stability: 0,
    stepPassRate: 0,
    avgLatencyMs: 0,
    avgCostUsd: 0,
    score: 0,
    executedScenarios: 0,
    skippedScenarios: 0
  };
}

function buildLeaderboard(modelSummaries: QaModelSummary[]): QaLeaderboardEntry[] {
  return [...modelSummaries]
    .sort((left, right) => right.metrics.score - left.metrics.score)
    .map((summary, index) => {
      const costSummary = summarizeUsageCosts(
        summary.scenarioRuns.map((run) => run.usageSummary),
        summary.scenarioRuns.length
      );
      return {
        rank: index + 1,
        modelId: summary.model.id,
        provider: summary.model.provider,
        score: summary.metrics.score,
        stepPassRate: summary.metrics.stepPassRate,
        capabilityPassRate: summary.metrics.capabilityPassRate,
        scenarioCompletionRate: summary.metrics.scenarioCompletionRate,
        stability: summary.metrics.stability,
        avgLatencyMs: summary.metrics.avgLatencyMs,
        avgCostUsd: costSummary.avgResolvedUsd,
        costSummary
      };
    });
}

function buildQaCostGraph(modelSummaries: QaModelSummary[]): CostGraph {
  return {
    title: "Guided Cost Breakdown",
    caption: "Resolved guided benchmark cost per model across all executed scenarios and trials.",
    stacked: false,
    series: [{ key: "guided", label: "Guided Scenarios", color: "#6d5430" }],
    data: modelSummaries.map((summary) => {
      const costSummary = summarizeUsageCosts(
        summary.scenarioRuns.map((run) => run.usageSummary),
        summary.scenarioRuns.length
      );
      return {
        modelId: summary.model.id,
        provider: summary.model.provider,
        values: {
          guided: costSummary.totalResolvedUsd
        },
        totalUsd: costSummary.totalResolvedUsd,
        costSource: costSummary.costSource,
        callCount: costSummary.callCount,
        note:
          costSummary.callCount === 0
            ? "No AI calls were required for this run."
            : costSummary.costSource === "unavailable"
              ? "One or more guided calls lacked exact provider usage."
              : undefined
      };
    })
  };
}

function buildQaSection(input: {
  appId: string;
  runId: string;
  leaderboard: QaLeaderboardEntry[];
}): BenchmarkComparisonSection {
  const topModel = input.leaderboard[0];
  return {
    kind: "qa",
    title: "Guided",
    summary: topModel
      ? `${topModel.modelId} leads guided mode with ${topModel.score.toFixed(3)} score, ${(topModel.scenarioCompletionRate * 100).toFixed(1)}% scenario completion, and total cost ${formatCostSummary(topModel.costSummary, "totalResolvedUsd")}.`
      : "No guided results were available.",
    appIds: [input.appId],
    metricColumns: QA_METRIC_COLUMNS,
    scoreDefinition: QA_SCORE_DEFINITION,
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
            stepPassRate: entry.stepPassRate,
            scenarioCompletion: entry.scenarioCompletionRate,
            capabilityPassRate: entry.capabilityPassRate,
            stability: entry.stability,
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
      "Stability is normalized to the full 0-1 range from binary scenario-outcome variance across trials.",
      "Total Cost sums resolved guided spend across the full run."
    ],
    audit: {
      title: "Guided Cost Audit",
      columns: ["Model", "Total Cost"],
      rows: input.leaderboard.map((entry) => [
        entry.modelId,
        formatCostSummary(entry.costSummary, "totalResolvedUsd")
      ])
    }
  };
}

function buildReport(artifact: QaRunArtifact): QaReport {
  const leaderboard = buildLeaderboard(artifact.modelSummaries);
  return {
    kind: "qa",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard,
    modelSummaries: artifact.modelSummaries,
    costGraph: buildQaCostGraph(artifact.modelSummaries),
    section: buildQaSection({
      appId: artifact.appId,
      runId: artifact.runId,
      leaderboard
    })
  };
}

function buildHtml(report: QaReport): string {
  const htmlReport: BenchmarkComparisonReport = {
    title: `${report.appId} Guided Report`,
    subtitle: `Matrix summary for guided execution across ${report.section.rows.length} model(s).`,
    generatedAt: report.generatedAt,
    runIds: [report.runId],
    appIds: [report.appId],
    modeSections: [report.section],
    finalReportPath: "",
    finalJsonPath: ""
  };
  return renderBenchmarkComparisonHtml(htmlReport);
}

async function persistQaOutput(resultsRoot: string, artifact: QaRunArtifact, report: QaReport): Promise<QaRunResult> {
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

function computeModelMetrics(summaryInput: {
  model: ModelAvailability;
  scenarioRuns: QaModelSummary["scenarioRuns"];
  capabilityRuns: QaModelSummary["capabilityRuns"];
}): QaModelMetrics {
  if (!summaryInput.model.available) {
    return zeroMetrics(summaryInput.model);
  }

  const scenarioSummary = summarizeScenarioRuns(summaryInput.scenarioRuns);
  const capabilityPassRate = summaryInput.capabilityRuns.length
    ? summaryInput.capabilityRuns.filter((item) => item.success).length / summaryInput.capabilityRuns.length
    : 0;

  return {
    modelId: summaryInput.model.id,
    capabilityPassRate: round(capabilityPassRate),
    scenarioCompletionRate: round(scenarioSummary.scenarioPassRate),
    stability: scenarioSummary.stability,
    stepPassRate: scenarioSummary.stepPassRate,
    avgLatencyMs: scenarioSummary.avgLatencyMs,
    avgCostUsd: scenarioSummary.costSummary.avgResolvedUsd,
    score: computeQaScore({
      capabilityPassRate,
      scenarioCompletionRate: scenarioSummary.scenarioPassRate,
      stepPassRate: scenarioSummary.stepPassRate,
      stability: scenarioSummary.stability,
      avgLatencyMs: scenarioSummary.avgLatencyMs,
      avgCostUsd: scenarioSummary.costSummary.avgResolvedUsd
    }),
    executedScenarios: summaryInput.scenarioRuns.length,
    skippedScenarios: 0
  };
}

export async function runQaExperiment(input: RunQaExperimentInput): Promise<QaRunResult> {
  await loadProjectEnv();
  const runStartedAtMs = Date.now();

  const preset = await loadQaPreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const capabilityIds = preset.capabilityIds ?? benchmark.benchmark.guided.capabilityIds;
  const scenarioIds = capabilityIds.flatMap(
    (capabilityId) => benchmark.capabilityMap.get(capabilityId)?.scenarioIds ?? []
  );
  const resultsDir = input.resultsDir ?? "results";
  if (input.resetModeResults !== false) {
    await clearQaOutputs(resultsDir);
  }
  const resultsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels =
    input.models ?? preset.models ?? registry.models.filter((model) => model.enabled).map((model) => model.id);
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: QaExperimentSpec = {
    appId: input.appId,
    capabilityIds,
    scenarioIds,
    models: models.map((model) => model.id),
    promptId: preset.promptId ?? benchmark.benchmark.prompts.guided,
    profile: GUIDED_RUNTIME_DEFAULTS.profile,
    trials: input.trials ?? preset.trials ?? benchmark.benchmark.runtime.guidedTrials,
    runtime: {
      profile: GUIDED_RUNTIME_DEFAULTS.profile,
      timeoutMs: input.timeoutMs ?? benchmark.benchmark.runtime.timeoutMs,
      retryCount: input.retryCount ?? benchmark.benchmark.runtime.retryCount,
      maxSteps: input.maxSteps ?? benchmark.benchmark.runtime.maxSteps,
      maxOutputTokens: input.maxOutputTokens ?? GUIDED_RUNTIME_DEFAULTS.maxOutputTokens,
      viewport: input.viewport ?? benchmark.benchmark.runtime.viewport
    },
    resultsDir
  };

  const runId = `guided-${input.appId}-${Date.now()}`;
  const parallelism = resolveParallelism(input.parallelism);
  const startedAt = nowIso();
  let completedScenarios = 0;
  const allScenarioRuns: ScenarioRunResult[] = [];
  const totalScenarios = models.filter((model) => model.available).length * spec.trials * spec.scenarioIds.length;
  emitExperimentLog(
    input.onLog,
    `[guided] Starting ${runId} for ${input.appId}: ${models.length} model(s), ${spec.trials} trial(s), ${spec.scenarioIds.length} scenario(s), model parallelism ${parallelism}`
  );
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    scenarioIds: spec.scenarioIds,
    bugIds: [],
    explorationMode: "guided",
    suiteId: runId,
    resultsDir,
    runtime: spec.runtime,
    promptIds: {
      guided: spec.promptId
    }
  });

  type QaProgressRecord = Parameters<typeof persistQaProgress>[2];
  const writeProgress = createProgressWriter<QaProgressRecord>((progress) =>
    persistQaProgress(resultsRoot, runId, progress)
  );
  const buildProgress = (overrides: Partial<QaProgressRecord> = {}): QaProgressRecord => ({
    appId: input.appId,
    profile: spec.profile,
    status: "running",
    startedAt,
    updatedAt: nowIso(),
    models: spec.models,
    trials: spec.trials,
    completedScenarios,
    totalScenarios,
    cumulativeUsage: sumAiUsageSummaries(allScenarioRuns.map((run) => run.usageSummary)),
    ...overrides
  });

  await writeProgress(buildProgress({ completedScenarios: 0 }));
  const runner = input.runner ?? new StagehandAutomationRunner();
  const modelSummaries = await mapWithConcurrency(models, parallelism, async (model, modelIndex) => {
    if (!model.available) {
      emitExperimentLog(
        input.onLog,
        `[guided] Skipping model ${modelIndex + 1}/${models.length} ${model.id}: ${model.reason ?? "unavailable"}`
      );
      return {
        model,
        metrics: zeroMetrics(model),
        scenarioRuns: [],
        capabilityRuns: []
      } satisfies QaModelSummary;
    }

    emitExperimentLog(input.onLog, `[guided] Model ${modelIndex + 1}/${models.length}: ${model.id} started`);
    const trialResults: Array<{
      scenarioRuns: QaModelSummary["scenarioRuns"];
      capabilityRuns: QaModelSummary["capabilityRuns"];
    }> = [];

    for (let trial = 1; trial <= spec.trials; trial += 1) {
      const attemptRunId = `${runId}-model-${modelIndex + 1}-trial-${trial}`;
      emitExperimentLog(
        input.onLog,
        `[guided] Trial ${trial}/${spec.trials} for ${model.id} started with a fresh workspace`
      );
      const workspace = await prepareRunWorkspace({
        resolvedSuite,
        runId: attemptRunId,
        resultsRoot
      });
      let autHandle: Awaited<ReturnType<typeof startAut>> | undefined;

      try {
        autHandle = await startAut(workspace.aut);
        const execution = await executeGuidedScenarios({
          runId: attemptRunId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          usagePhase: "guided_scenario",
          systemPrompt: resolvedSuite.prompts.guided,
          onLog: input.onLog,
          scenarioLabel: `[guided][${model.id}][trial ${trial}] guided scenario`,
          onScenarioRunComplete: async ({ scenarioIndex, scenarioId, result }) => {
            completedScenarios += 1;
            allScenarioRuns.push(result);
            await writeProgress(
              buildProgress({
                currentModelId: model.id,
                currentTrial: trial,
                currentScenarioIndex: scenarioIndex + 1,
                currentScenarioId: scenarioId,
                lastScenarioResult: slimScenarioRunForProgress(result)
              })
            );
          }
        });
        const passedScenarios = execution.scenarioRuns.filter((run) => run.success).length;
        emitExperimentLog(
          input.onLog,
          `[guided] Trial ${trial}/${spec.trials} for ${model.id} completed: ${passedScenarios}/${execution.scenarioRuns.length} scenarios passed`
        );

        trialResults.push({
          scenarioRuns: execution.scenarioRuns,
          capabilityRuns: capabilityIds.map((capabilityId) => {
            const capability = benchmark.capabilityMap.get(capabilityId)!;
            const relevantRuns = execution.scenarioRuns.filter((run) => capability.scenarioIds.includes(run.scenarioId));
            return {
              capabilityId,
              title: capability.title,
              trial,
              success: relevantRuns.length > 0 && relevantRuns.every((run) => run.success),
              scenarioIds: capability.scenarioIds,
              failedScenarioIds: relevantRuns.filter((run) => !run.success).map((run) => run.scenarioId)
            };
          })
        });
      } finally {
        await autHandle?.stop();
      }
    }

    const scenarioRuns = trialResults.flatMap((trialResult) => trialResult.scenarioRuns);
    const capabilityRuns = trialResults.flatMap((trialResult) => trialResult.capabilityRuns);
    const scenarioSummary = summarizeScenarioRuns(scenarioRuns);
    const metrics = computeModelMetrics({
      model,
      scenarioRuns,
      capabilityRuns
    });
    const summary = {
      model,
      metrics,
      cacheSummary: scenarioSummary.cacheSummary,
      scenarioRuns,
      capabilityRuns
    } satisfies QaModelSummary;

    emitExperimentLog(
      input.onLog,
      `[guided] Model ${model.id} completed: score ${metrics.score.toFixed(3)}, scenario pass ${(metrics.scenarioCompletionRate * 100).toFixed(1)}%, capability pass ${(metrics.capabilityPassRate * 100).toFixed(1)}%`
    );
    await writeProgress(
      buildProgress({
        currentModelId: model.id,
        lastScenarioResult: scenarioRuns.length ? slimScenarioRunForProgress(scenarioRuns.at(-1)!) : undefined
      })
    );
    return summary;
  });

  const artifact: QaRunArtifact = {
    kind: "qa",
    runId,
    appId: input.appId,
    startedAt,
    finishedAt: nowIso(),
    spec,
    modelSummaries
  };
  const output = await persistQaOutput(resultsRoot, artifact, buildReport(artifact));
  await writeProgress(
    buildProgress({
      status: "completed",
      lastScenarioResult: allScenarioRuns.length ? slimScenarioRunForProgress(allScenarioRuns.at(-1)!) : undefined
    })
  );
  emitExperimentLog(
    input.onLog,
    `[guided] Completed ${runId} in ${formatDurationMs(Date.now() - runStartedAtMs)}. Report: ${output.reportPath}`
  );
  return output;
}

export async function getQaReport(runId: string, resultsDir = "results"): Promise<QaReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const raw = await readFile(join(reportsRoot, "runs", runId, "run.json"), "utf8");
  return buildReport(JSON.parse(raw) as QaRunArtifact);
}

export function buildQaComparison(reports: Array<{ section: BenchmarkComparisonSection }>): ModeComparisonBuildResult {
  const initialSection = aggregateModeSection(
    reports.map((report) => report.section),
    `Guided matrix across ${reports.length} run(s).`
  );
  const aggregateLeaderboard = buildAggregateLeaderboard(initialSection);
  const topModel = aggregateLeaderboard[0];
  const modeSection: BenchmarkComparisonSection = {
    ...initialSection,
    summary: topModel
      ? `${topModel.modelId} leads guided comparison with ${topModel.avgScore.toFixed(3)} average score across ${topModel.runs} run(s).`
      : initialSection.summary
  };

  return {
    aggregateLeaderboard,
    modeSection
  };
}

export async function compareQaRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<QaReport>> {
  const reports = await Promise.all(runIds.map((runId) => getQaReport(runId, resultsDir)));
  const { aggregateLeaderboard, modeSection } = buildQaComparison(reports);
  const finalReport = await persistComparisonReport({
    title: "Guided Mode Comparison",
    subtitle: `Matrix comparison across ${reports.length} guided run(s).`,
    runIds,
    modeSections: [modeSection],
    resultsDir,
    prefix: "guided-compare",
    stableName: "guided-compare-latest"
  });

  return {
    kind: "qa",
    reports,
    aggregateLeaderboard,
    modeSection,
    finalReportPath: finalReport.finalReportPath,
    finalJsonPath: finalReport.finalJsonPath
  };
}
