import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { AutomationRunner, ModelAvailability, TaskRunResult } from "../types.js";
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
  persistComparisonReport
} from "./comparison.js";
import {
  buildResolvedSuite,
  emitExperimentLog,
  executeGuidedTasks,
  formatDurationMs,
  resolveExperimentRoot,
  round,
  summarizeTaskRuns
} from "./common.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { formatCostSource, formatCostSummary } from "./report-utils.js";
import { computeQaScore } from "./scoring.js";
import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn,
  CompareResult,
  CostGraph,
  ModeComparisonBuildResult,
  QaExecutionProfile,
  QaExperimentSpec,
  QaLeaderboardEntry,
  QaModelMetrics,
  QaModelSummary,
  QaReport,
  QaRunArtifact,
  QaRunResult
} from "./types.js";
import type { ExperimentLogFn } from "./types.js";

const FAST_QA_PROFILE = {
  models: ["google/gemma-3-27b-it:free"],
  trials: 1,
  timeoutMs: 45_000,
  retryCount: 0,
  maxSteps: 8,
  maxOutputTokens: 300
} as const;

const FULL_QA_PROFILE = {
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
  { key: "taskPassRate", label: "Task Pass", kind: "percent", aggregate: "mean" },
  { key: "scenarioCompletion", label: "Scenario Completion", kind: "percent", aggregate: "mean" },
  { key: "capabilityPassRate", label: "Capability Pass", kind: "percent", aggregate: "mean" },
  { key: "stability", label: "Stability", kind: "score", aggregate: "mean" },
  { key: "avgLatency", label: "Avg Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

export interface RunQaExperimentInput {
  appId: string;
  profile?: QaExecutionProfile;
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
  resultsDir?: string;
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

function resolveQaProfile(profile?: QaExecutionProfile | string): QaExecutionProfile {
  if (!profile) {
    return "fast";
  }
  if (profile === "fast" || profile === "full") {
    return profile;
  }
  throw new Error(`unsupported QA profile ${profile}`);
}

function slimTaskRunForProgress(run: TaskRunResult) {
  return {
    taskId: run.taskId,
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
    profile: QaExecutionProfile;
    status: "running" | "completed";
    startedAt: string;
    updatedAt: string;
    models: string[];
    trials: number;
    currentModelId?: string;
    currentTrial?: number;
    currentTaskIndex?: number;
    currentTaskId?: string;
    completedTasks: number;
    totalTasks: number;
    cumulativeUsage: ReturnType<typeof sumAiUsageSummaries>;
    lastTaskResult?: ReturnType<typeof slimTaskRunForProgress>;
  }
): Promise<void> {
  const runDir = join(resultsRoot, "runs", runId);
  await ensureDir(runDir);
  await writeJson(join(runDir, "progress.json"), progress);
}

function zeroMetrics(model: ModelAvailability): QaModelMetrics {
  return {
    modelId: model.id,
    capabilityPassRate: 0,
    fullScenarioCompletionRate: 0,
    stability: 0,
    taskPassRate: 0,
    avgLatencyMs: 0,
    avgCostUsd: 0,
    score: 0,
    executedTasks: 0,
    skippedTasks: 0
  };
}

function buildLeaderboard(modelSummaries: QaModelSummary[]): QaLeaderboardEntry[] {
  return [...modelSummaries]
    .sort((left, right) => right.metrics.score - left.metrics.score)
    .map((summary, index) => {
      const costSummary = summarizeUsageCosts(summary.taskRuns.map((run) => run.usageSummary), summary.taskRuns.length);
      return {
        rank: index + 1,
        modelId: summary.model.id,
        provider: summary.model.provider,
        score: summary.metrics.score,
        taskPassRate: summary.metrics.taskPassRate,
        capabilityPassRate: summary.metrics.capabilityPassRate,
        fullScenarioCompletionRate: summary.metrics.fullScenarioCompletionRate,
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
    caption: "Resolved guided benchmark cost per model across all executed tasks and trials.",
    stacked: false,
    series: [{ key: "guided", label: "Guided Tasks", color: "#6d5430" }],
    data: modelSummaries.map((summary) => {
      const costSummary = summarizeUsageCosts(summary.taskRuns.map((run) => run.usageSummary), summary.taskRuns.length);
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
      ? `${topModel.modelId} leads guided mode with ${topModel.score.toFixed(3)} score, ${(topModel.fullScenarioCompletionRate * 100).toFixed(1)}% scenario completion, and ${formatCostSummary(topModel.costSummary, "totalResolvedUsd")} total cost.`
      : "No guided results were available.",
    appIds: [input.appId],
    metricColumns: QA_METRIC_COLUMNS,
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
            taskPassRate: entry.taskPassRate,
            scenarioCompletion: entry.fullScenarioCompletionRate,
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
      "Avg Cost is resolved spend per executed guided task.",
      "Total Cost sums resolved guided spend across the full run.",
      "Unavailable labels indicate calls where the provider response lacked exact usage cost.",
      "No AI calls indicates the run completed without invoking a model."
    ],
    audit: {
      title: "Guided Cost Audit",
      columns: ["Model", "Avg Cost", "Total Cost", "Source", "Calls", "Unavailable Calls"],
      rows: input.leaderboard.map((entry) => [
        entry.modelId,
        formatCostSummary(entry.costSummary, "avgResolvedUsd"),
        formatCostSummary(entry.costSummary, "totalResolvedUsd"),
        formatCostSource(entry.costSummary),
        String(entry.costSummary.callCount),
        String(entry.costSummary.unavailableCalls)
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
    subtitle: `Matrix summary for guided execution across ${report.leaderboard.length} model(s).`,
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

function computeModelMetrics(summaryInput: {
  model: ModelAvailability;
  taskRuns: QaModelSummary["taskRuns"];
  capabilityRuns: QaModelSummary["capabilityRuns"];
  trials: number;
}): QaModelMetrics {
  if (!summaryInput.model.available) {
    return zeroMetrics(summaryInput.model);
  }

  const taskSummary = summarizeTaskRuns(summaryInput.taskRuns);
  const capabilityPassRate = summaryInput.capabilityRuns.length
    ? summaryInput.capabilityRuns.filter((item) => item.success).length / summaryInput.capabilityRuns.length
    : 0;
  const fullScenarioCompletionRate =
    summaryInput.trials > 0
      ? [...new Set(summaryInput.taskRuns.map((run) => run.trial))]
          .map((trial) => summaryInput.taskRuns.filter((run) => run.trial === trial).every((run) => run.success))
          .filter(Boolean).length / summaryInput.trials
      : 0;

  return {
    modelId: summaryInput.model.id,
    capabilityPassRate: round(capabilityPassRate),
    fullScenarioCompletionRate: round(fullScenarioCompletionRate),
    stability: taskSummary.stability,
    taskPassRate: taskSummary.taskPassRate,
    avgLatencyMs: taskSummary.avgLatencyMs,
    avgCostUsd: taskSummary.costSummary.avgResolvedUsd,
    score: computeQaScore({
      capabilityPassRate,
      fullScenarioCompletionRate,
      taskPassRate: taskSummary.taskPassRate,
      stability: taskSummary.stability,
      avgLatencyMs: taskSummary.avgLatencyMs,
      avgCostUsd: taskSummary.costSummary.avgResolvedUsd
    }),
    executedTasks: summaryInput.taskRuns.length,
    skippedTasks: 0
  };
}

export async function runQaExperiment(input: RunQaExperimentInput): Promise<QaRunResult> {
  await loadProjectEnv();
  const runStartedAtMs = Date.now();

  const preset = await loadQaPreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const profile = resolveQaProfile(input.profile);
  const capabilityIds = preset.capabilityIds ?? benchmark.benchmark.qa.capabilityIds;
  const taskIds = capabilityIds.flatMap((capabilityId) => benchmark.capabilityMap.get(capabilityId)?.taskIds ?? []);
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels =
    input.models ??
    preset.models ??
    (profile === "fast"
      ? [...FAST_QA_PROFILE.models]
      : registry.models.filter((model) => model.enabled).map((model) => model.id));
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: QaExperimentSpec = {
    appId: input.appId,
    capabilityIds,
    taskIds,
    models: models.map((model) => model.id),
    promptId: preset.promptId ?? benchmark.benchmark.prompts.qa,
    profile,
    trials:
      input.trials ??
      preset.trials ??
      (profile === "fast" ? FAST_QA_PROFILE.trials : benchmark.benchmark.runtime.qaTrials),
    runtime: {
      profile,
      timeoutMs:
        input.timeoutMs ??
        (profile === "fast" ? FAST_QA_PROFILE.timeoutMs : benchmark.benchmark.runtime.timeoutMs),
      retryCount:
        input.retryCount ??
        (profile === "fast" ? FAST_QA_PROFILE.retryCount : benchmark.benchmark.runtime.retryCount),
      maxSteps:
        input.maxSteps ??
        (profile === "fast" ? FAST_QA_PROFILE.maxSteps : benchmark.benchmark.runtime.maxSteps),
      maxOutputTokens:
        input.maxOutputTokens ??
        (profile === "fast" ? FAST_QA_PROFILE.maxOutputTokens : FULL_QA_PROFILE.maxOutputTokens),
      viewport: input.viewport ?? benchmark.benchmark.runtime.viewport
    },
    resultsDir
  };

  const runId = `qa-${input.appId}-${Date.now()}`;
  const startedAt = nowIso();
  let completedTasks = 0;
  const allTaskRuns: TaskRunResult[] = [];
  emitExperimentLog(
    input.onLog,
    `[qa] Starting ${runId} for ${input.appId}: ${models.length} model(s), ${spec.trials} trial(s), ${spec.taskIds.length} task(s)`
  );
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    taskIds: spec.taskIds,
    bugIds: [],
    explorationMode: "guided",
    suiteId: runId,
    resultsDir,
    runtime: spec.runtime,
    promptIds: {
      guided: spec.promptId
    }
  });

  await persistQaProgress(resultsRoot, runId, {
    appId: input.appId,
    profile,
    status: "running",
    startedAt,
    updatedAt: nowIso(),
    models: spec.models,
    trials: spec.trials,
    completedTasks: 0,
    totalTasks: spec.models.length * spec.trials * spec.taskIds.length,
    cumulativeUsage: sumAiUsageSummaries([])
  });
  const runner = input.runner ?? new StagehandAutomationRunner();
  const modelSummaries: QaModelSummary[] = [];

  for (const [modelIndex, model] of models.entries()) {
    if (!model.available) {
      emitExperimentLog(
        input.onLog,
        `[qa] Skipping model ${modelIndex + 1}/${models.length} ${model.id}: ${model.reason ?? "unavailable"}`
      );
      modelSummaries.push({
        model,
        metrics: zeroMetrics(model),
        taskRuns: [],
        capabilityRuns: []
      });
      continue;
    }

    const taskRuns: QaModelSummary["taskRuns"] = [];
    const capabilityRuns: QaModelSummary["capabilityRuns"] = [];
    emitExperimentLog(input.onLog, `[qa] Model ${modelIndex + 1}/${models.length}: ${model.id} started`);

    for (let trial = 1; trial <= spec.trials; trial += 1) {
      emitExperimentLog(
        input.onLog,
        `[qa] Trial ${trial}/${spec.trials} for ${model.id} started with a fresh workspace`
      );
      const workspace = await prepareRunWorkspace({
        resolvedSuite,
        runId,
        resultsRoot
      });
      const autHandle = await startAut(workspace.aut);

      try {
        const execution = await executeGuidedTasks({
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          usagePhase: "guided_task",
          systemPrompt: resolvedSuite.prompts.guided,
          onLog: input.onLog,
          taskLabel: `[qa][${model.id}][trial ${trial}] guided task`,
          onTaskRunComplete: async ({ taskIndex, taskId, result }) => {
            completedTasks += 1;
            allTaskRuns.push(result);
            await persistQaProgress(resultsRoot, runId, {
              appId: input.appId,
              profile,
              status: "running",
              startedAt,
              updatedAt: nowIso(),
              models: spec.models,
              trials: spec.trials,
              currentModelId: model.id,
              currentTrial: trial,
              currentTaskIndex: taskIndex + 1,
              currentTaskId: taskId,
              completedTasks,
              totalTasks: spec.models.length * spec.trials * spec.taskIds.length,
              cumulativeUsage: sumAiUsageSummaries(allTaskRuns.map((run) => run.usageSummary)),
              lastTaskResult: slimTaskRunForProgress(result)
            });
          }
        });
        taskRuns.push(...execution.taskRuns);
        const passedTasks = execution.taskRuns.filter((run) => run.success).length;
        emitExperimentLog(
          input.onLog,
          `[qa] Trial ${trial}/${spec.trials} for ${model.id} completed: ${passedTasks}/${execution.taskRuns.length} tasks passed`
        );

        for (const capabilityId of capabilityIds) {
          const capability = benchmark.capabilityMap.get(capabilityId)!;
          const relevantRuns = execution.taskRuns.filter((run) => capability.taskIds.includes(run.taskId));
          capabilityRuns.push({
            capabilityId,
            title: capability.title,
            trial,
            success: relevantRuns.length > 0 && relevantRuns.every((run) => run.success),
            taskIds: capability.taskIds,
            failedTaskIds: relevantRuns.filter((run) => !run.success).map((run) => run.taskId)
          });
        }
      } finally {
        await autHandle?.stop();
      }
    }

    const taskSummary = summarizeTaskRuns(taskRuns);
    const metrics = computeModelMetrics({
      model,
      taskRuns,
      capabilityRuns,
      trials: spec.trials
    });
    modelSummaries.push({
      model,
      metrics,
      cacheSummary: taskSummary.cacheSummary,
      taskRuns,
      capabilityRuns
    });
    emitExperimentLog(
      input.onLog,
      `[qa] Model ${model.id} completed: score ${metrics.score.toFixed(3)}, task pass ${(metrics.taskPassRate * 100).toFixed(1)}%, capability pass ${(metrics.capabilityPassRate * 100).toFixed(1)}%`
    );
    await persistQaProgress(resultsRoot, runId, {
      appId: input.appId,
      profile,
      status: "running",
      startedAt,
      updatedAt: nowIso(),
      models: spec.models,
      trials: spec.trials,
      currentModelId: model.id,
      completedTasks,
      totalTasks: spec.models.length * spec.trials * spec.taskIds.length,
      cumulativeUsage: sumAiUsageSummaries(allTaskRuns.map((run) => run.usageSummary)),
      lastTaskResult: taskRuns.length ? slimTaskRunForProgress(taskRuns.at(-1)!) : undefined
    });
  }

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
  await persistQaProgress(resultsRoot, runId, {
    appId: input.appId,
    profile,
    status: "completed",
    startedAt,
    updatedAt: nowIso(),
    models: spec.models,
    trials: spec.trials,
    completedTasks,
    totalTasks: spec.models.length * spec.trials * spec.taskIds.length,
    cumulativeUsage: sumAiUsageSummaries(allTaskRuns.map((run) => run.usageSummary)),
    lastTaskResult: allTaskRuns.length ? slimTaskRunForProgress(allTaskRuns.at(-1)!) : undefined
  });
  emitExperimentLog(
    input.onLog,
    `[qa] Completed ${runId} in ${formatDurationMs(Date.now() - runStartedAtMs)}. Report: ${output.reportPath}`
  );
  return output;
}

export async function getQaReport(runId: string, resultsDir = "results"): Promise<QaReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const raw = await readFile(join(reportsRoot, "reports", `${runId}.json`), "utf8");
  return JSON.parse(raw) as QaReport;
}

export function buildQaComparison(reports: QaReport[]): ModeComparisonBuildResult {
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
    prefix: "qa-compare"
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
