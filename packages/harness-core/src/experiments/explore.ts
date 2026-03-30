import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { ActionCacheEntry, AutomationRunner, ModelAvailability } from "../types.js";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "../cache/config.js";
import { summarizeTaskRunCache } from "../cache/summary.js";
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
import {
  aggregateModeSection,
  buildAggregateLeaderboard,
  persistComparisonReport
} from "./comparison.js";
import { buildResolvedSuite, executeGuidedTasks, resolveExperimentRoot, round, summarizeTaskRuns, unique } from "./common.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { formatCostSource, formatCostSummary } from "./report-utils.js";
import { computeExploreScore } from "./scoring.js";
import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn,
  CompareResult,
  CostGraph,
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

const EXPLORE_METRIC_COLUMNS: BenchmarkMetricColumn[] = [
  { key: "score", label: "Score", kind: "score", aggregate: "mean" },
  { key: "capabilityDiscovery", label: "Capability Discovery", kind: "percent", aggregate: "mean" },
  { key: "stateCoverage", label: "State Coverage", kind: "percent", aggregate: "mean" },
  { key: "transitionCoverage", label: "Transition Coverage", kind: "percent", aggregate: "mean" },
  { key: "probeReplay", label: "Probe Replay", kind: "percent", aggregate: "mean" },
  { key: "actionDiversity", label: "Action Diversity", kind: "percent", aggregate: "mean" },
  { key: "avgLatency", label: "Avg Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

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
    .map((summary, index) => {
      const costSummary = summarizeUsageCosts(summary.trials.map((trial) => trial.totalUsage), summary.trials.length);
      return {
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
        avgCostUsd: costSummary.avgResolvedUsd,
        costSummary
      };
    });
}

function buildExploreCostGraph(modelSummaries: ExploreModelSummary[]): CostGraph {
  return {
    title: "Exploration Cost Breakdown",
    caption: "Resolved exploration spend per model, split between autonomous exploration and probe replay.",
    stacked: true,
    series: [
      { key: "explore", label: "Explore", color: "#9d6a21" },
      { key: "probe", label: "Probe Replay", color: "#42577a" }
    ],
    data: modelSummaries.map((summary) => {
      const explorationUsage = sumAiUsageSummaries(summary.trials.map((trial) => trial.explorationUsage));
      const probeUsage = sumAiUsageSummaries(summary.trials.map((trial) => trial.probeUsage));
      const costSummary = summarizeUsageCosts(summary.trials.map((trial) => trial.totalUsage), summary.trials.length);
      return {
        modelId: summary.model.id,
        provider: summary.model.provider,
        values: {
          explore: explorationUsage.resolvedCostUsd ?? explorationUsage.costUsd ?? 0,
          probe: probeUsage.resolvedCostUsd ?? probeUsage.costUsd ?? 0
        },
        totalUsd: costSummary.totalResolvedUsd,
        costSource: costSummary.costSource,
        callCount: costSummary.callCount,
        note:
          costSummary.callCount === 0
            ? "No AI calls were required for this run."
            : costSummary.costSource === "unavailable"
              ? "One or more exploration or probe calls lacked exact provider usage."
              : undefined
      };
    })
  };
}

function buildExploreSection(input: {
  appId: string;
  runId: string;
  leaderboard: ExploreLeaderboardEntry[];
}): BenchmarkComparisonSection {
  const topModel = input.leaderboard[0];
  return {
    kind: "explore",
    title: "Explore",
    summary: topModel
      ? `${topModel.modelId} leads explore mode with ${topModel.score.toFixed(3)} score, ${(topModel.capabilityDiscoveryRate * 100).toFixed(1)}% capability discovery, and ${formatCostSummary(topModel.costSummary, "totalResolvedUsd")} total cost.`
      : "No exploration results were available.",
    appIds: [input.appId],
    metricColumns: EXPLORE_METRIC_COLUMNS,
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
            capabilityDiscovery: entry.capabilityDiscoveryRate,
            stateCoverage: entry.stateCoverage,
            transitionCoverage: entry.transitionCoverage,
            probeReplay: entry.probeReplayPassRate,
            actionDiversity: entry.actionDiversity,
            avgLatency: entry.avgLatencyMs,
            avgCost: entry.costSummary.avgResolvedUsd,
            totalCost: entry.costSummary.totalResolvedUsd
          },
          costSummary: entry.costSummary
        }
      ]
    })),
    notes: [
      "Capability Discovery, State Coverage, and Transition Coverage are the primary exploration outcomes.",
      "Avg Cost is resolved spend per exploration trial.",
      "Unavailable labels indicate calls where the provider response lacked exact usage cost.",
      "No AI calls indicates the run completed without invoking a model."
    ],
    audit: {
      title: "Explore Cost Audit",
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

function buildReport(artifact: ExploreRunArtifact): ExploreReport {
  const leaderboard = buildLeaderboard(artifact.modelSummaries);
  return {
    kind: "explore",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard,
    modelSummaries: artifact.modelSummaries,
    costGraph: buildExploreCostGraph(artifact.modelSummaries),
    section: buildExploreSection({
      appId: artifact.appId,
      runId: artifact.runId,
      leaderboard
    })
  };
}

function buildHtml(report: ExploreReport): string {
  const htmlReport: BenchmarkComparisonReport = {
    title: `${report.appId} Explore Report`,
    subtitle: `Matrix summary for autonomous exploration across ${report.leaderboard.length} model(s).`,
    generatedAt: report.generatedAt,
    runIds: [report.runId],
    appIds: [report.appId],
    modeSections: [report.section],
    finalReportPath: "",
    finalJsonPath: ""
  };
  return renderBenchmarkComparisonHtml(htmlReport);
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

  const discoveries = summaryInput.trials.flatMap((trial) => trial.capabilityDiscovery);
  const capabilityDiscoveryRate = discoveries.length
    ? round(discoveries.filter((item) => item.discovered).length / discoveries.length)
    : 0;
  const probeRuns = summaryInput.trials.flatMap((trial) => trial.probeRuns);
  const probeSummary = summarizeTaskRuns(probeRuns.map((item) => item.taskRun));
  const totalUsage = sumAiUsageSummaries(summaryInput.trials.map((trial) => trial.totalUsage));
  const costSummary = summarizeUsageCosts(summaryInput.trials.map((trial) => trial.totalUsage), summaryInput.trials.length);
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
  const avgLatencyMs = round(totalUsage.latencyMs / summaryInput.trials.length, 3);

  return {
    modelId: summaryInput.model.id,
    capabilityDiscoveryRate,
    probeReplayPassRate: probeSummary.taskPassRate,
    stateCoverage,
    transitionCoverage,
    actionDiversity,
    avgLatencyMs,
    avgCostUsd: costSummary.avgResolvedUsd,
    score: computeExploreScore({
      capabilityDiscoveryRate,
      probeReplayPassRate: probeSummary.taskPassRate,
      stateCoverage,
      transitionCoverage,
      actionDiversity,
      avgLatencyMs,
      avgCostUsd: costSummary.avgResolvedUsd
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
      const probeTaskRuns: ExploreProbeRun["taskRun"][] = [];
      const explorationPrompt = resolvedSuite.prompts.autonomous ?? spec.promptId;
      const exploreCacheConfig = await resolveExecutionCacheConfig({
        resultsDir,
        targetId: input.appId,
        bugIds: [],
        viewport: spec.runtime.viewport,
        modelId: model.id,
        configSignature: buildStagehandConfigSignature({
          executionKind: "explore",
          instructionPrompt: explorationPrompt
        })
      });

      for (let trial = 1; trial <= spec.trials; trial += 1) {
        const explorationArtifact = await runner.exploreTarget({
          model,
          trial,
          targetId: input.appId,
          bugIds: [],
          prompt: explorationPrompt,
          aut: workspace.aut,
          runConfig: {
            timeoutMs: spec.runtime.timeoutMs,
            retryCount: spec.runtime.retryCount,
            maxSteps: spec.runtime.maxSteps,
            viewport: spec.runtime.viewport
          },
          cacheConfig: exploreCacheConfig,
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

        const probeExecution = await executeGuidedTasks({
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          usagePhase: "probe_replay",
          systemPrompt: resolvedSuite.prompts.guided,
          taskIds: spec.probeTaskIds
        });
        probeTaskRuns.push(...probeExecution.taskRuns);
        const probeSummary = summarizeTaskRuns(probeExecution.taskRuns);
        const probeRuns: ExploreProbeRun[] = probeExecution.taskRuns.map((taskRun) => ({
          trial,
          taskId: taskRun.taskId,
          success: taskRun.success,
          matchedActionIds: [],
          taskRun
        }));

        trials.push({
          trial,
          explorationRunId: explorationArtifact.explorationRunId,
          statesDiscovered: explorationArtifact.summary.statesDiscovered,
          transitionsDiscovered: explorationArtifact.summary.transitionsDiscovered,
          actionsCached: explorationArtifact.summary.actionsCached,
          actionKinds: inferActionKinds(explorationArtifact.actionCache),
          cacheSummary: explorationArtifact.cacheSummary,
          explorationUsage: explorationArtifact.usageSummary,
          probeUsage: probeSummary.usageSummary,
          totalUsage: sumAiUsageSummaries([explorationArtifact.usageSummary, probeSummary.usageSummary]),
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
        probeCacheSummary: summarizeTaskRunCache(probeTaskRuns),
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
  const reports = await Promise.all(runIds.map((runId) => getExploreReport(runId, resultsDir)));
  const initialSection = aggregateModeSection(
    reports.map((report) => report.section),
    `Explore matrix across ${reports.length} run(s).`
  );
  const aggregateLeaderboard = buildAggregateLeaderboard(initialSection);
  const topModel = aggregateLeaderboard[0];
  const modeSection: BenchmarkComparisonSection = {
    ...initialSection,
    summary: topModel
      ? `${topModel.modelId} leads explore comparison with ${topModel.avgScore.toFixed(3)} average score across ${topModel.runs} run(s).`
      : initialSection.summary
  };
  const finalReport = await persistComparisonReport({
    title: "Explore Mode Comparison",
    subtitle: `Matrix comparison across ${reports.length} exploration run(s).`,
    runIds,
    modeSections: [modeSection],
    resultsDir,
    prefix: "explore-compare"
  });

  return {
    kind: "explore",
    reports,
    aggregateLeaderboard,
    modeSection,
    finalReportPath: finalReport.finalReportPath,
    finalJsonPath: finalReport.finalJsonPath
  };
}
