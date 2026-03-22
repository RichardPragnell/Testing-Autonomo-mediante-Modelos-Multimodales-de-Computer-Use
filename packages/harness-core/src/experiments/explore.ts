import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ActionCacheEntry, AutomationRunner, ModelAvailability } from "../types.js";
import { loadModelRegistry, resolveModelAvailability } from "../config/model-registry.js";
import { loadProjectEnv } from "../env/load.js";
import { matchActionCache } from "../exploration/action-cache.js";
import { persistRunExplorationArtifacts } from "../persistence/store.js";
import { StagehandAutomationRunner } from "../runner/stagehand-runner.js";
import { prepareRunWorkspace } from "../runtime/workspace.js";
import { startAut } from "../runtime/aut.js";
import { nowIso } from "../utils/time.js";
import { ensureDir, resolveWorkspacePath, writeJson, writeText } from "../utils/fs.js";
import { loadAppBenchmark } from "./benchmark.js";
import { buildResolvedSuite, executeGuidedTasks, resolveExperimentRoot, round, summarizeTaskRuns, unique } from "./common.js";
import { renderExperimentDashboard } from "./report-html.js";
import { computeExploreScore } from "./scoring.js";
import type {
  CompareResult,
  ExploreCapabilityDiscovery,
  ExploreExperimentSpec,
  ExploreLeaderboardEntry,
  ExploreModelMetrics,
  ExploreModelSummary,
  ExploreProbeRun,
  ExploreReport,
  ExploreRunArtifact,
  ExploreRunResult,
  ExploreTrialArtifact
} from "./types.js";

const explorePresetSchema = z
  .object({
    capabilityIds: z.array(z.string()).optional(),
    probeTaskIds: z.array(z.string()).optional(),
    promptId: z.string().optional(),
    trials: z.number().int().min(1).optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough();

export interface RunExploreExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  resultsDir?: string;
  runner?: AutomationRunner;
}

async function loadExplorePreset(pathLike?: string): Promise<z.infer<typeof explorePresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return explorePresetSchema.parse(JSON.parse(raw));
}

function inferActionKinds(entries: ActionCacheEntry[]): string[] {
  const kinds = new Set<string>();
  for (const entry of entries) {
    const haystack = [entry.description, entry.selector, entry.method ?? "", ...entry.arguments, ...entry.instructionHints]
      .join(" ")
      .toLowerCase();

    if (/(open|goto|home|page title|load)/.test(haystack)) {
      kinds.add("navigate");
    }
    if (/(add|new task|composer|create)/.test(haystack)) {
      kinds.add("add");
    }
    if (/(toggle|checkbox|complete|done)/.test(haystack)) {
      kinds.add("toggle");
    }
    if (/(filter|active|completed|all)/.test(haystack)) {
      kinds.add("filter");
    }
    if (/(edit|rename|save|outline)/.test(haystack)) {
      kinds.add("edit");
    }
    if (/(delete|remove|trash)/.test(haystack)) {
      kinds.add("delete");
    }
  }
  return [...kinds].sort();
}

function zeroMetrics(model: ModelAvailability): ExploreModelMetrics {
  return {
    modelId: model.id,
    capabilityDiscoveryRate: 0,
    probeReplayPassRate: 0,
    stateCoverage: 0,
    transitionCoverage: 0,
    actionDiversity: 0,
    avgLatencyMs: 0,
    avgCostUsd: 0,
    score: 0
  };
}

function buildLeaderboard(modelSummaries: ExploreModelSummary[]): ExploreLeaderboardEntry[] {
  return [...modelSummaries]
    .sort((left, right) => right.metrics.score - left.metrics.score)
    .map((summary, index) => ({
      rank: index + 1,
      modelId: summary.model.id,
      provider: summary.model.provider,
      score: summary.metrics.score,
      capabilityDiscoveryRate: summary.metrics.capabilityDiscoveryRate,
      probeReplayPassRate: summary.metrics.probeReplayPassRate,
      stateCoverage: summary.metrics.stateCoverage,
      transitionCoverage: summary.metrics.transitionCoverage,
      actionDiversity: summary.metrics.actionDiversity,
      avgLatencyMs: summary.metrics.avgLatencyMs,
      avgCostUsd: summary.metrics.avgCostUsd
    }));
}

function buildReport(artifact: ExploreRunArtifact): ExploreReport {
  return {
    kind: "explore",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard: buildLeaderboard(artifact.modelSummaries),
    modelSummaries: artifact.modelSummaries
  };
}

function buildHtml(report: ExploreReport): string {
  return renderExperimentDashboard({
    title: `${report.appId} Exploration Benchmark`,
    subtitle: `Autonomous exploration coverage across ${report.leaderboard.length} model(s).`,
    scoreBars: report.leaderboard.map((entry) => ({
      label: entry.modelId,
      value: entry.score,
      max: 100,
      hint: `${(entry.capabilityDiscoveryRate * 100).toFixed(1)}% capability discovery`
    })),
    secondaryCharts: [
      {
        title: "Capability Discovery",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.capabilityDiscoveryRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Probe Replay",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.probeReplayPassRate * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "State Coverage",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.stateCoverage * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      },
      {
        title: "Action Diversity",
        items: report.leaderboard.map((entry) => ({
          label: entry.modelId,
          value: entry.actionDiversity * 100,
          max: 100
        })),
        formatter: (value) => `${value.toFixed(1)}%`
      }
    ],
    leaderboardHeaders: ["Rank", "Model", "Score", "Discovery", "Probe Replay", "States", "Transitions", "Actions"],
    leaderboardRows: report.leaderboard.map((entry) => [
      entry.rank,
      entry.modelId,
      entry.score.toFixed(3),
      `${(entry.capabilityDiscoveryRate * 100).toFixed(1)}%`,
      `${(entry.probeReplayPassRate * 100).toFixed(1)}%`,
      `${(entry.stateCoverage * 100).toFixed(1)}%`,
      `${(entry.transitionCoverage * 100).toFixed(1)}%`,
      `${(entry.actionDiversity * 100).toFixed(1)}%`
    ])
  });
}

async function persistExploreOutput(resultsRoot: string, artifact: ExploreRunArtifact, report: ExploreReport): Promise<ExploreRunResult> {
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
  trials: ExploreTrialArtifact[];
  heuristicTargets: ExploreExperimentSpec["heuristicTargets"];
}): ExploreModelMetrics {
  if (!summaryInput.model.available || summaryInput.trials.length === 0) {
    return zeroMetrics(summaryInput.model);
  }

  const capabilityDiscoveryRate = round(
    summaryInput.trials.flatMap((trial) => trial.capabilityDiscovery).filter((item) => item.discovered).length /
      summaryInput.trials.flatMap((trial) => trial.capabilityDiscovery).length
  );

  const probeRuns = summaryInput.trials.flatMap((trial) => trial.probeRuns);
  const probeSummary = summarizeTaskRuns(probeRuns.map((item) => item.taskRun));
  const avgStates = summaryInput.trials.reduce((sum, trial) => sum + trial.statesDiscovered, 0) / summaryInput.trials.length;
  const avgTransitions =
    summaryInput.trials.reduce((sum, trial) => sum + trial.transitionsDiscovered, 0) / summaryInput.trials.length;
  const actionKinds = unique(summaryInput.trials.flatMap((trial) => trial.actionKinds));
  const stateCoverage = round(Math.min(1, avgStates / summaryInput.heuristicTargets.minStates));
  const transitionCoverage = round(Math.min(1, avgTransitions / summaryInput.heuristicTargets.minTransitions));
  const actionDiversity = round(
    Math.min(
      1,
      actionKinds.filter((kind) => summaryInput.heuristicTargets.actionKinds.includes(kind)).length /
        summaryInput.heuristicTargets.actionKinds.length
    )
  );

  return {
    modelId: summaryInput.model.id,
    capabilityDiscoveryRate,
    probeReplayPassRate: probeSummary.taskPassRate,
    stateCoverage,
    transitionCoverage,
    actionDiversity,
    avgLatencyMs: probeSummary.avgLatencyMs,
    avgCostUsd: probeSummary.avgCostUsd,
    score: computeExploreScore({
      capabilityDiscoveryRate,
      probeReplayPassRate: probeSummary.taskPassRate,
      stateCoverage,
      transitionCoverage,
      actionDiversity,
      avgLatencyMs: probeSummary.avgLatencyMs,
      avgCostUsd: probeSummary.avgCostUsd
    })
  };
}

export async function runExploreExperiment(input: RunExploreExperimentInput): Promise<ExploreRunResult> {
  await loadProjectEnv();

  const preset = await loadExplorePreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const capabilityIds = preset.capabilityIds ?? benchmark.benchmark.explore.capabilityIds;
  const probeTaskIds = preset.probeTaskIds ?? benchmark.benchmark.explore.probeTaskIds;
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveExperimentRoot(resultsDir, "explore");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels = input.models ?? preset.models;
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: ExploreExperimentSpec = {
    appId: input.appId,
    capabilityIds,
    probeTaskIds,
    models: requestedModels,
    promptId: preset.promptId ?? benchmark.benchmark.prompts.explore,
    trials: input.trials ?? preset.trials ?? benchmark.benchmark.runtime.exploreTrials,
    runtime: {
      timeoutMs: benchmark.benchmark.runtime.timeoutMs,
      retryCount: benchmark.benchmark.runtime.retryCount,
      maxSteps: benchmark.benchmark.runtime.maxSteps,
      viewport: benchmark.benchmark.runtime.viewport
    },
    resultsDir,
    heuristicTargets: benchmark.benchmark.explore.heuristicTargets
  };

  const runId = `explore-${input.appId}-${Date.now()}`;
  const startedAt = nowIso();
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    taskIds: spec.probeTaskIds,
    bugIds: [],
    explorationMode: "autonomous",
    suiteId: runId,
    resultsDir,
    runtime: spec.runtime,
    promptIds: {
      guided: benchmark.benchmark.prompts.qa,
      autonomous: spec.promptId
    }
  });

  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });
  const runner = input.runner ?? new StagehandAutomationRunner();
  if (typeof runner.exploreTarget !== "function") {
    throw new Error("selected automation runner does not support autonomous exploration");
  }

  const autHandle = await startAut(workspace.aut);
  const modelSummaries: ExploreModelSummary[] = [];

  try {
    for (const model of models) {
      if (!model.available) {
        modelSummaries.push({
          model,
          metrics: zeroMetrics(model),
          trials: []
        });
        continue;
      }

      const trials: ExploreTrialArtifact[] = [];

      for (let trial = 1; trial <= spec.trials; trial += 1) {
        const explorationArtifact = await runner.exploreTarget({
          model,
          trial,
          targetId: input.appId,
          bugIds: [],
          prompt: resolvedSuite.prompts.autonomous ?? spec.promptId,
          aut: workspace.aut,
          runConfig: {
            timeoutMs: spec.runtime.timeoutMs,
            retryCount: spec.runtime.retryCount,
            maxSteps: spec.runtime.maxSteps,
            viewport: spec.runtime.viewport
          },
          workspacePath: workspace.workspacePath
        });
        await persistRunExplorationArtifacts(resultsRoot, runId, explorationArtifact);

        const capabilityDiscovery: ExploreCapabilityDiscovery[] = capabilityIds.map((capabilityId) => {
          const capability = benchmark.capabilityMap.get(capabilityId)!;
          const matchedActionIds = unique(
            capability.taskIds.flatMap((taskId) =>
              matchActionCache({
                cache: explorationArtifact.actionCache,
                instruction: benchmark.tasks.get(taskId)?.instruction ?? "",
                limit: 3
              }).map((entry) => entry.actionId)
            )
          );
          return {
            capabilityId,
            title: capability.title,
            trial,
            discovered: matchedActionIds.length > 0,
            matchedActionIds
          };
        });

        const cacheHints = new Map<string, ActionCacheEntry[]>();
        for (const taskId of spec.probeTaskIds) {
          const task = benchmark.tasks.get(taskId)!;
          cacheHints.set(
            taskId,
            matchActionCache({
              cache: explorationArtifact.actionCache,
              instruction: task.instruction,
              limit: 3
            })
          );
        }

        const probeExecution = await executeGuidedTasks({
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          systemPrompt: resolvedSuite.prompts.guided,
          cacheHints,
          taskIds: spec.probeTaskIds
        });
        const probeRuns: ExploreProbeRun[] = probeExecution.taskRuns.map((taskRun) => ({
          trial,
          taskId: taskRun.taskId,
          success: taskRun.success,
          matchedActionIds: cacheHints.get(taskRun.taskId)?.map((entry) => entry.actionId) ?? [],
          taskRun
        }));

        trials.push({
          trial,
          explorationRunId: explorationArtifact.explorationRunId,
          statesDiscovered: explorationArtifact.summary.statesDiscovered,
          transitionsDiscovered: explorationArtifact.summary.transitionsDiscovered,
          actionsCached: explorationArtifact.summary.actionsCached,
          actionKinds: inferActionKinds(explorationArtifact.actionCache),
          capabilityDiscovery,
          probeRuns
        });
      }

      modelSummaries.push({
        model,
        metrics: computeModelMetrics({
          model,
          trials,
          heuristicTargets: spec.heuristicTargets
        }),
        trials
      });
    }
  } finally {
    await autHandle?.stop();
  }

  const artifact: ExploreRunArtifact = {
    kind: "explore",
    runId,
    appId: input.appId,
    startedAt,
    finishedAt: nowIso(),
    spec,
    modelSummaries
  };

  return persistExploreOutput(resultsRoot, artifact, buildReport(artifact));
}

export async function getExploreReport(runId: string, resultsDir = "results"): Promise<ExploreReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "explore");
  const raw = await readFile(join(reportsRoot, "reports", `${runId}.json`), "utf8");
  return JSON.parse(raw) as ExploreReport;
}

export async function compareExploreRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<ExploreReport>> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "explore");
  const reports = await Promise.all(runIds.map((runId) => getExploreReport(runId, resultsDir)));
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
    title: "Exploration Benchmark Comparison",
    subtitle: `Aggregate comparison across ${reports.length} exploration run(s).`,
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
