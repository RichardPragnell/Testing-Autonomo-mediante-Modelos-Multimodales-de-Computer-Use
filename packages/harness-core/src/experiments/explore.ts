import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { formatUsageCost, sumAiUsageSummaries } from "../ai/usage.js";
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
import { buildResolvedSuite, executeGuidedTasks, resolveExperimentRoot, round, summarizeTaskRuns, unique } from "./common.js";
import { renderCostGraphSvg } from "./cost-graph.js";
import {
  screenshotDataUrl,
  selectExploreBaselineRun,
  selectExploreBestTrial,
  selectExploreRepresentativeProbeRun
} from "./report-figures.js";
import { renderPaperReport } from "./report-html.js";
import { computeExploreScore } from "./scoring.js";
import type {
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

function buildExploreCostGraph(modelSummaries: ExploreModelSummary[]): CostGraph {
  return {
    title: "Exploration Cost Breakdown",
    caption: "Total exploration-mode cost per model, split between autonomous exploration and probe replay.",
    stacked: true,
    series: [
      { key: "explore", label: "Explore", color: "#c47f2c" },
      { key: "probe", label: "Probe Replay", color: "#4d5b7c" }
    ],
    data: modelSummaries.map((summary) => {
      const explorationUsage = sumAiUsageSummaries(summary.trials.map((trial) => trial.explorationUsage));
      const probeUsage = sumAiUsageSummaries(summary.trials.map((trial) => trial.probeUsage));
      const totalUsage = sumAiUsageSummaries([explorationUsage, probeUsage]);
      return {
        modelId: summary.model.id,
        provider: summary.model.provider,
        values: {
          explore: explorationUsage.costUsd ?? 0,
          probe: probeUsage.costUsd ?? 0
        },
        totalUsd: totalUsage.costUsd,
        costSource: totalUsage.costSource,
        note: totalUsage.costSource === "unavailable" ? "One or more exploration or probe calls did not resolve an exact gateway cost." : undefined
      };
    })
  };
}

function buildReport(artifact: ExploreRunArtifact): ExploreReport {
  return {
    kind: "explore",
    runId: artifact.runId,
    appId: artifact.appId,
    generatedAt: nowIso(),
    spec: artifact.spec,
    leaderboard: buildLeaderboard(artifact.modelSummaries),
    modelSummaries: artifact.modelSummaries,
    costGraph: buildExploreCostGraph(artifact.modelSummaries)
  };
}

function buildHtml(report: ExploreReport): string {
  const orderedSummaries = [...report.modelSummaries].sort((left, right) => {
    const leftRank = report.leaderboard.find((entry) => entry.modelId === left.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = report.leaderboard.find((entry) => entry.modelId === right.model.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const baselineRun = selectExploreBaselineRun(report);
  const topModel = report.leaderboard[0];

  return renderPaperReport({
    title: `${report.appId} Exploration Mode Report`,
    subtitle: `Autonomous exploration coverage across ${report.leaderboard.length} model(s).`,
    abstract: topModel
      ? `${topModel.modelId} ranked first in exploration mode with a score of ${topModel.score.toFixed(3)}, discovering ${(topModel.capabilityDiscoveryRate * 100).toFixed(1)}% of benchmark capabilities with ${(topModel.actionDiversity * 100).toFixed(1)}% action diversity.`
      : "Exploration mode summarizes autonomous capability discovery and probe replay coverage.",
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
          "Exploration mode measures whether models discover useful application affordances before being asked to replay benchmark probes."
        ],
        facts: [
          { label: "Capabilities", value: String(report.spec.capabilityIds.length) },
          { label: "Probe Tasks", value: String(report.spec.probeTaskIds.length) },
          { label: "Min States", value: String(report.spec.heuristicTargets.minStates) },
          { label: "Min Transitions", value: String(report.spec.heuristicTargets.minTransitions) }
        ]
      }
    ],
    figure: {
      title: "Unified Exploration Figure",
      caption: "Baseline application state plus one representative exploration-result panel per model.",
      panels: [
        {
          label: "A",
          title: "Test App Baseline",
          subtitle: baselineRun?.taskId ?? "No baseline probe screenshot",
          imageDataUrl: screenshotDataUrl(baselineRun?.screenshotBase64),
          imageAlt: "Baseline exploration application screenshot",
          metrics: baselineRun
            ? [
                { label: "Source Task", value: baselineRun.taskId },
                { label: "Outcome", value: baselineRun.success ? "Passed" : "Observed" }
              ]
            : [],
          caption: baselineRun
            ? "Baseline AUT state selected from the first available successful smoke probe."
            : "No exploration smoke screenshot was available in this run."
        },
        ...orderedSummaries.map((summary, index) => {
          const bestTrial = selectExploreBestTrial(summary);
          const representativeProbe = selectExploreRepresentativeProbeRun(summary);
          return {
            label: String.fromCharCode(66 + index),
            title: summary.model.id,
            subtitle: representativeProbe?.taskId ?? "No representative exploration screenshot",
            imageDataUrl: screenshotDataUrl(representativeProbe?.taskRun.screenshotBase64),
            imageAlt: `${summary.model.id} exploration result screenshot`,
            metrics: [
              { label: "Score", value: summary.metrics.score.toFixed(3) },
              { label: "Discovery", value: `${(summary.metrics.capabilityDiscoveryRate * 100).toFixed(1)}%` },
              { label: "Probe Replay", value: `${(summary.metrics.probeReplayPassRate * 100).toFixed(1)}%` },
              { label: "States", value: String(bestTrial?.statesDiscovered ?? 0) },
              { label: "Transitions", value: String(bestTrial?.transitionsDiscovered ?? 0) },
              { label: "Action Diversity", value: `${(summary.metrics.actionDiversity * 100).toFixed(1)}%` }
            ],
            caption: representativeProbe
              ? `Representative exploration panel chosen from trial ${bestTrial?.trial ?? representativeProbe.trial}, probe ${representativeProbe.taskId}.`
              : "No successful probe screenshot was available for this model."
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
          ? "Models marked unavailable encountered at least one exploration or probe replay call without an exact gateway lookup."
          : undefined
      }
    ],
    tables: [
      {
        title: "Quantitative Results",
        columns: ["Rank", "Model", "Score", "Discovery", "Probe Replay", "States", "Transitions", "Actions"],
        rows: report.leaderboard.map((entry) => [
          String(entry.rank),
          entry.modelId,
          entry.score.toFixed(3),
          `${(entry.capabilityDiscoveryRate * 100).toFixed(1)}%`,
          `${(entry.probeReplayPassRate * 100).toFixed(1)}%`,
          `${(entry.stateCoverage * 100).toFixed(1)}%`,
          `${(entry.transitionCoverage * 100).toFixed(1)}%`,
          `${(entry.actionDiversity * 100).toFixed(1)}%`
        ])
      },
      {
        title: "Exploration Cost Audit",
        columns: ["Model", "Trial", "Explore Cost", "Probe Cost", "Total Cost", "Source"],
        rows: orderedSummaries.flatMap((summary) =>
          summary.trials.map((trial) => [
            summary.model.id,
            String(trial.trial),
            formatUsageCost(trial.explorationUsage),
            formatUsageCost(trial.probeUsage),
            formatUsageCost(trial.totalUsage),
            trial.totalUsage?.costSource ?? "unavailable"
          ])
        )
      }
    ],
    appendix: orderedSummaries.map((summary) => {
      const bestTrial = selectExploreBestTrial(summary);
      return {
        title: summary.model.id,
        body: [
          `Best exploration trial discovered ${bestTrial?.statesDiscovered ?? 0} states and ${bestTrial?.transitionsDiscovered ?? 0} transitions.`
        ],
        facts: [
          { label: "Best Trial", value: String(bestTrial?.trial ?? 0) },
          { label: "Actions Cached", value: String(bestTrial?.actionsCached ?? 0) },
          { label: "Action Kinds", value: (bestTrial?.actionKinds ?? []).join(", ") || "none" },
          { label: "Average Latency", value: `${summary.metrics.avgLatencyMs.toFixed(0)} ms` }
        ]
      };
    })
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
  const totalUsage = sumAiUsageSummaries(summaryInput.trials.map((trial) => trial.totalUsage));
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
    avgLatencyMs: round(totalUsage.latencyMs / summaryInput.trials.length, 3),
    avgCostUsd: round((totalUsage.costUsd ?? 0) / summaryInput.trials.length),
    score: computeExploreScore({
      capabilityDiscoveryRate,
      probeReplayPassRate: probeSummary.taskPassRate,
      stateCoverage,
      transitionCoverage,
      actionDiversity,
      avgLatencyMs: round(totalUsage.latencyMs / summaryInput.trials.length, 3),
      avgCostUsd: round((totalUsage.costUsd ?? 0) / summaryInput.trials.length)
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
          probeUsage: summarizeTaskRuns(probeExecution.taskRuns).usageSummary,
          totalUsage: sumAiUsageSummaries([
            explorationArtifact.usageSummary,
            summarizeTaskRuns(probeExecution.taskRuns).usageSummary
          ]),
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

  const html = renderPaperReport({
    title: "Exploration Mode Comparison",
    subtitle: `Aggregate comparison across ${reports.length} exploration-mode run(s).`,
    abstract:
      aggregateLeaderboard[0]
        ? `${aggregateLeaderboard[0].modelId} achieved the highest mean exploration score across ${reports.length} run(s), with an average score of ${aggregateLeaderboard[0].avgScore.toFixed(3)}.`
        : "Aggregate exploration-mode comparison across benchmark runs.",
    meta: [
      { label: "Runs Compared", value: String(reports.length) },
      { label: "Models Compared", value: String(aggregateLeaderboard.length) }
    ],
    sections: [
      {
        title: "Experiment Setup",
        body: ["This aggregate page summarizes average exploration-mode scores across previously generated run reports."]
      }
    ],
    figure: {
      title: "Aggregate Score Figure",
      caption: "Average exploration-mode score per model across the selected run set.",
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
