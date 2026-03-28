import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AutomationRunner, ModelAvailability } from "../types.js";
import { loadModelRegistry, resolveModelAvailability } from "../config/model-registry.js";
import { loadProjectEnv } from "../env/load.js";
import { StagehandAutomationRunner } from "../runner/stagehand-runner.js";
import { prepareRunWorkspace } from "../runtime/workspace.js";
import { startAut } from "../runtime/aut.js";
import { nowIso } from "../utils/time.js";
import { ensureDir, resolveWorkspacePath, writeJson, writeText } from "../utils/fs.js";
import { loadAppBenchmark } from "./benchmark.js";
import { buildResolvedSuite, executeGuidedTasks, resolveExperimentRoot, round, summarizeTaskRuns } from "./common.js";
import { renderExperimentDashboard } from "./report-html.js";
import { computeQaScore } from "./scoring.js";
import type {
  CompareResult,
  QaExperimentSpec,
  QaLeaderboardEntry,
  QaModelMetrics,
  QaModelSummary,
  QaReport,
  QaRunArtifact,
  QaRunResult
} from "./types.js";

const qaPresetSchema = z
  .object({
    capabilityIds: z.array(z.string()).optional(),
    promptId: z.string().optional(),
    trials: z.number().int().min(1).optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough();

export interface RunQaExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  resultsDir?: string;
  runner?: AutomationRunner;
}

async function loadQaPreset(pathLike?: string): Promise<z.infer<typeof qaPresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return qaPresetSchema.parse(JSON.parse(raw));
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
    .map((summary, index) => ({
      rank: index + 1,
      modelId: summary.model.id,
      provider: summary.model.provider,
      score: summary.metrics.score,
      capabilityPassRate: summary.metrics.capabilityPassRate,
      fullScenarioCompletionRate: summary.metrics.fullScenarioCompletionRate,
      stability: summary.metrics.stability,
      avgLatencyMs: summary.metrics.avgLatencyMs,
      avgCostUsd: summary.metrics.avgCostUsd
    }));
}

function buildReport(artifact: QaRunArtifact): QaReport {
  return {
    kind: "qa",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard: buildLeaderboard(artifact.modelSummaries),
    modelSummaries: artifact.modelSummaries
  };
}

function buildHtml(report: QaReport): string {
  return renderExperimentDashboard({
    title: `${report.appId} QA Benchmark`,
    subtitle: `Guided scenario execution across ${report.leaderboard.length} model(s).`,
    scoreBars: report.leaderboard.map((entry) => ({
      label: entry.modelId,
      value: entry.score,
      max: 100,
      hint: `${(entry.capabilityPassRate * 100).toFixed(1)}% capability pass`
    })),
    secondaryCharts: [
      {
        title: "Capability Pass Rate",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.capabilityPassRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Full Scenario Completion",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.fullScenarioCompletionRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Average Latency",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.avgLatencyMs
        })),
        formatter: (value) => `${value.toFixed(0)} ms`
      },
      {
        title: "Average Cost",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.avgCostUsd
        })),
        formatter: (value) => `$${value.toFixed(4)}`
      }
    ],
    leaderboardHeaders: ["Rank", "Model", "Score", "Capability", "Scenario", "Stability", "Latency", "Cost"],
    leaderboardRows: report.leaderboard.map((entry) => [
      entry.rank,
      entry.modelId,
      entry.score.toFixed(3),
      `${(entry.capabilityPassRate * 100).toFixed(1)}%`,
      `${(entry.fullScenarioCompletionRate * 100).toFixed(1)}%`,
      entry.stability.toFixed(3),
      `${entry.avgLatencyMs.toFixed(0)} ms`,
      `$${entry.avgCostUsd.toFixed(4)}`
    ])
  });
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
    avgCostUsd: taskSummary.avgCostUsd,
    score: computeQaScore({
      capabilityPassRate,
      fullScenarioCompletionRate,
      stability: taskSummary.stability,
      avgLatencyMs: taskSummary.avgLatencyMs,
      avgCostUsd: taskSummary.avgCostUsd
    }),
    executedTasks: summaryInput.taskRuns.length,
    skippedTasks: 0
  };
}

export async function runQaExperiment(input: RunQaExperimentInput): Promise<QaRunResult> {
  await loadProjectEnv();

  const preset = await loadQaPreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const capabilityIds = preset.capabilityIds ?? benchmark.benchmark.qa.capabilityIds;
  const taskIds = capabilityIds.flatMap((capabilityId) => benchmark.capabilityMap.get(capabilityId)?.taskIds ?? []);
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels = input.models ?? preset.models;
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: QaExperimentSpec = {
    appId: input.appId,
    capabilityIds,
    taskIds,
    models: requestedModels,
    promptId: preset.promptId ?? benchmark.benchmark.prompts.qa,
    trials: input.trials ?? preset.trials ?? benchmark.benchmark.runtime.qaTrials,
    runtime: {
      timeoutMs: benchmark.benchmark.runtime.timeoutMs,
      retryCount: benchmark.benchmark.runtime.retryCount,
      maxSteps: benchmark.benchmark.runtime.maxSteps,
      viewport: benchmark.benchmark.runtime.viewport
    },
    resultsDir
  };

  const runId = `qa-${input.appId}-${Date.now()}`;
  const startedAt = nowIso();
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

  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });
  const runner = input.runner ?? new StagehandAutomationRunner();
  const autHandle = await startAut(workspace.aut);
  const modelSummaries: QaModelSummary[] = [];

  try {
    for (const model of models) {
      if (!model.available) {
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

      for (let trial = 1; trial <= spec.trials; trial += 1) {
        const execution = await executeGuidedTasks({
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          systemPrompt: resolvedSuite.prompts.guided
        });
        taskRuns.push(...execution.taskRuns);

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
      }

      modelSummaries.push({
        model,
        metrics: computeModelMetrics({
          model,
          taskRuns,
          capabilityRuns,
          trials: spec.trials
        }),
        cacheSummary: summarizeTaskRuns(taskRuns).cacheSummary,
        taskRuns,
        capabilityRuns
      });
    }
  } finally {
    await autHandle?.stop();
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
  return persistQaOutput(resultsRoot, artifact, buildReport(artifact));
}

export async function getQaReport(runId: string, resultsDir = "results"): Promise<QaReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const raw = await readFile(join(reportsRoot, "reports", `${runId}.json`), "utf8");
  return JSON.parse(raw) as QaReport;
}

export async function compareQaRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<QaReport>> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "qa");
  const reports = await Promise.all(runIds.map((runId) => getQaReport(runId, resultsDir)));
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
    title: "QA Benchmark Comparison",
    subtitle: `Aggregate comparison across ${reports.length} QA run(s).`,
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
