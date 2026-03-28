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
import { screenshotDataUrl, selectQaBaselineRun, selectQaRepresentativeRun } from "./report-figures.js";
import { renderPaperReport } from "./report-html.js";
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
  const orderedSummaries = [...report.modelSummaries].sort((left, right) => {
    const leftRank = report.leaderboard.find((entry) => entry.modelId === left.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = report.leaderboard.find((entry) => entry.modelId === right.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const baselineRun = selectQaBaselineRun(report);
  const topModel = report.leaderboard[0];

  return renderPaperReport({
    title: `${report.appId} Guided Mode Report`,
    subtitle: `Guided scenario execution across ${report.leaderboard.length} model(s).`,
    abstract: topModel
      ? `${topModel.modelId} ranked first in guided mode with a score of ${topModel.score.toFixed(3)}, combining ${(topModel.capabilityPassRate * 100).toFixed(1)}% capability pass and ${(topModel.fullScenarioCompletionRate * 100).toFixed(1)}% full-scenario completion.`
      : "Guided mode summarizes prompt-following performance across the configured benchmark scenarios.",
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
          "Guided mode evaluates prompt-following behavior on the benchmark task suite using repeated scenario execution against the local test application."
        ],
        facts: [
          { label: "Capabilities", value: String(report.spec.capabilityIds.length) },
          { label: "Tasks", value: String(report.spec.taskIds.length) },
          { label: "Timeout", value: `${report.spec.runtime.timeoutMs} ms` },
          { label: "Viewport", value: `${report.spec.runtime.viewport.width} × ${report.spec.runtime.viewport.height}` }
        ]
      }
    ],
    figure: {
      title: "Unified Guided Figure",
      caption: "Baseline application state plus one representative guided result per model.",
      panels: [
        {
          label: "A",
          title: "Test App Baseline",
          subtitle: baselineRun?.taskId ?? "No baseline screenshot",
          imageDataUrl: screenshotDataUrl(baselineRun?.screenshotBase64),
          imageAlt: "Baseline benchmark application screenshot",
          metrics: baselineRun
            ? [
                { label: "Source Task", value: baselineRun.taskId },
                { label: "Outcome", value: baselineRun.success ? "Passed" : "Observed" }
              ]
            : [],
          caption: baselineRun
            ? "Baseline AUT state selected from the first available successful smoke validation."
            : "No guided smoke screenshot was available in this run."
        },
        ...orderedSummaries.map((summary, index) => {
          const representativeRun = selectQaRepresentativeRun(summary);
          return {
            label: String.fromCharCode(66 + index),
            title: summary.model.id,
            subtitle: representativeRun?.taskId ?? "No representative guided screenshot",
            imageDataUrl: screenshotDataUrl(representativeRun?.screenshotBase64),
            imageAlt: `${summary.model.id} guided result screenshot`,
            metrics: [
              { label: "Score", value: summary.metrics.score.toFixed(3) },
              { label: "Capability Pass", value: `${(summary.metrics.capabilityPassRate * 100).toFixed(1)}%` },
              { label: "Scenario Completion", value: `${(summary.metrics.fullScenarioCompletionRate * 100).toFixed(1)}%` },
              { label: "Latency", value: `${summary.metrics.avgLatencyMs.toFixed(0)} ms` },
              { label: "Cost", value: `$${summary.metrics.avgCostUsd.toFixed(4)}` }
            ],
            caption: representativeRun
              ? `Representative guided result selected from ${representativeRun.taskId}.`
              : "No successful guided screenshot was available for this model."
          };
        })
      ]
    },
    tables: [
      {
        title: "Quantitative Results",
        columns: ["Rank", "Model", "Score", "Capability", "Scenario", "Stability", "Latency", "Cost"],
        rows: report.leaderboard.map((entry) => [
          String(entry.rank),
          entry.modelId,
          entry.score.toFixed(3),
          `${(entry.capabilityPassRate * 100).toFixed(1)}%`,
          `${(entry.fullScenarioCompletionRate * 100).toFixed(1)}%`,
          entry.stability.toFixed(3),
          `${entry.avgLatencyMs.toFixed(0)} ms`,
          `$${entry.avgCostUsd.toFixed(4)}`
        ])
      }
    ],
    appendix: orderedSummaries.map((summary) => ({
      title: summary.model.id,
      body: [
        `Task pass rate was ${(summary.metrics.taskPassRate * 100).toFixed(1)}% across ${summary.metrics.executedTasks} executed tasks.`
      ],
      facts: [
        { label: "Executed Tasks", value: String(summary.metrics.executedTasks) },
        { label: "Skipped Tasks", value: String(summary.metrics.skippedTasks) },
        { label: "Task Pass", value: `${(summary.metrics.taskPassRate * 100).toFixed(1)}%` },
        { label: "Stability", value: summary.metrics.stability.toFixed(3) }
      ]
    }))
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

  const html = renderPaperReport({
    title: "Guided Mode Comparison",
    subtitle: `Aggregate comparison across ${reports.length} guided-mode run(s).`,
    abstract:
      aggregateLeaderboard[0]
        ? `${aggregateLeaderboard[0].modelId} achieved the highest mean guided score across ${reports.length} run(s), with an average score of ${aggregateLeaderboard[0].avgScore.toFixed(3)}.`
        : "Aggregate guided-mode comparison across benchmark runs.",
    meta: [
      { label: "Runs Compared", value: String(reports.length) },
      { label: "Models Compared", value: String(aggregateLeaderboard.length) }
    ],
    sections: [
      {
        title: "Experiment Setup",
        body: ["This aggregate page summarizes average guided-mode scores across previously generated run reports."]
      }
    ],
    figure: {
      title: "Aggregate Score Figure",
      caption: "Average guided-mode score per model across the selected run set.",
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
