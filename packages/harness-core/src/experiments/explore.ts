import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { ActionCacheEntry, AutomationRunner, BenchmarkScenario, ModelAvailability } from "../types.js";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "../cache/config.js";
import { summarizeScenarioRunCache } from "../cache/summary.js";
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
  summarizeScenarioRuns,
  unique
} from "./common.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { formatCostSummary } from "./report-utils.js";
import { computeExploreScore, EXPLORE_SCORE_DEFINITION } from "./scoring.js";
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
  ExploreTrialArtifact,
  ModeComparisonBuildResult
} from "./types.js";
import type { ExperimentLogFn } from "./types.js";

const explorePresetSchema = z
  .object({
    capabilityIds: z.array(z.string()).optional(),
    probeScenarioIds: z.array(z.string()).optional(),
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
  { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

export interface RunExploreExperimentInput {
  appId: string;
  models?: string[];
  modelsPath?: string;
  presetPath?: string;
  trials?: number;
  parallelism?: number;
  resultsDir?: string;
  resetModeResults?: boolean;
  runner?: AutomationRunner;
  onLog?: ExperimentLogFn;
}

async function loadExplorePreset(pathLike?: string): Promise<z.infer<typeof explorePresetSchema>> {
  if (!pathLike) {
    return {};
  }
  const path = await resolveWorkspacePath(pathLike);
  const raw = await readFile(path, "utf8");
  return explorePresetSchema.parse(JSON.parse(raw));
}

async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function clearExploreOutputs(resultsDir: string): Promise<void> {
  const workspaceRoot = await resolveWorkspacePath(resultsDir);
  await Promise.all([
    removePathIfExists(join(workspaceRoot, "explore", "runs")),
    removePathIfExists(join(workspaceRoot, "explore", "reports")),
    removeComparisonReports(resultsDir, ["explore-compare", "benchmark-compare"])
  ]);
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
      ? `${topModel.modelId} leads explore mode with ${topModel.score.toFixed(3)} score, ${(topModel.capabilityDiscoveryRate * 100).toFixed(1)}% capability discovery, and total cost ${formatCostSummary(topModel.costSummary, "totalResolvedUsd")}.`
      : "No exploration results were available.",
    appIds: [input.appId],
    metricColumns: EXPLORE_METRIC_COLUMNS,
    scoreDefinition: EXPLORE_SCORE_DEFINITION,
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
      "Score is shown on a 0-100 scale where higher is better.",
      "Capability Discovery and probe replay carry the strongest weight, with state and transition coverage providing the supporting breadth signal.",
      "Total Cost sums resolved exploration spend across the full run."
    ],
    audit: {
      title: "Explore Cost Audit",
      columns: ["Model", "Total Cost"],
      rows: input.leaderboard.map((entry) => [
        entry.modelId,
        formatCostSummary(entry.costSummary, "totalResolvedUsd")
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
    subtitle: `Matrix summary for autonomous exploration across ${report.section.rows.length} model(s).`,
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

function scenarioActionHints(scenario: BenchmarkScenario): Array<{ stepId: string; instruction: string }> {
  const hints: Array<{ stepId: string; instruction: string }> = [];
  for (const step of scenario.steps) {
    if (step.actionInstruction) {
      hints.push({ stepId: step.stepId, instruction: step.actionInstruction });
    }
    for (const assertion of step.assertions) {
      if (assertion.type === "observe") {
        hints.push({ stepId: step.stepId, instruction: assertion.instruction });
      }
    }
  }
  return hints;
}

function discoverScenario(
  scenario: BenchmarkScenario,
  actionCache: ActionCacheEntry[],
  hasVisitedRoot: boolean
): { discovered: boolean; matchedStepIds: string[]; matchedActionIds: string[] } {
  const hints = scenarioActionHints(scenario);
  if (hints.length === 0) {
    return {
      discovered: hasVisitedRoot,
      matchedStepIds: hasVisitedRoot && scenario.steps[0] ? [scenario.steps[0].stepId] : [],
      matchedActionIds: []
    };
  }

  const matchedStepIds: string[] = [];
  const matchedActionIds: string[] = [];
  for (const hint of hints) {
    const matches = matchActionCache({
      cache: actionCache,
      instruction: hint.instruction,
      limit: 3
    });
    if (matches.length === 0) {
      continue;
    }
    matchedStepIds.push(hint.stepId);
    matchedActionIds.push(...matches.map((entry) => entry.actionId));
  }

  return {
    discovered: matchedActionIds.length > 0,
    matchedStepIds: unique(matchedStepIds),
    matchedActionIds: unique(matchedActionIds)
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
  const probeSummary = summarizeScenarioRuns(probeRuns.map((item) => item.scenarioRun));
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
    probeReplayPassRate: probeSummary.scenarioPassRate,
    stateCoverage,
    transitionCoverage,
    actionDiversity,
    avgLatencyMs,
    avgCostUsd: costSummary.avgResolvedUsd,
    score: computeExploreScore({
      capabilityDiscoveryRate,
      probeReplayPassRate: probeSummary.scenarioPassRate,
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
  const runStartedAtMs = Date.now();

  const preset = await loadExplorePreset(input.presetPath);
  const benchmark = await loadAppBenchmark(input.appId);
  const capabilityIds = preset.capabilityIds ?? benchmark.benchmark.explore.capabilityIds;
  const probeScenarioIds = preset.probeScenarioIds ?? benchmark.benchmark.explore.probeScenarioIds;
  const resultsDir = input.resultsDir ?? "results";
  if (input.resetModeResults !== false) {
    await clearExploreOutputs(resultsDir);
  }
  const resultsRoot = await resolveExperimentRoot(resultsDir, "explore");
  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(modelsPath);
  const requestedModels =
    input.models ?? preset.models ?? registry.models.filter((model) => model.enabled).map((model) => model.id);
  const models = resolveModelAvailability(registry, requestedModels);
  const spec: ExploreExperimentSpec = {
    appId: input.appId,
    capabilityIds,
    probeScenarioIds,
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
  const parallelism = resolveParallelism(input.parallelism);
  const startedAt = nowIso();
  emitExperimentLog(
    input.onLog,
    `[explore] Starting ${runId} for ${input.appId}: ${models.length} model(s), ${spec.trials} trial(s), ${spec.probeScenarioIds.length} probe scenario(s), model parallelism ${parallelism}`
  );
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    scenarioIds: spec.probeScenarioIds,
    bugIds: [],
    explorationMode: "autonomous",
    suiteId: runId,
    resultsDir,
    runtime: spec.runtime,
    promptIds: {
      guided: benchmark.benchmark.prompts.guided,
      autonomous: spec.promptId
    }
  });

  const runner = input.runner ?? new StagehandAutomationRunner();
  if (typeof runner.exploreTarget !== "function") {
    throw new Error("selected automation runner does not support autonomous exploration");
  }
  const exploreTarget = runner.exploreTarget.bind(runner);

  const modelSummaries = await mapWithConcurrency(models, parallelism, async (model, modelIndex) => {
    if (!model.available) {
      emitExperimentLog(
        input.onLog,
        `[explore] Skipping model ${modelIndex + 1}/${models.length} ${model.id}: ${model.reason ?? "unavailable"}`
      );
      return {
        model,
        metrics: zeroMetrics(model),
        trials: []
      } satisfies ExploreModelSummary;
    }

    const trials: ExploreTrialArtifact[] = [];
    const probeScenarioRuns: ExploreProbeRun["scenarioRun"][] = [];
    const explorationPrompt = resolvedSuite.prompts.autonomous ?? spec.promptId;
    const runConfig = {
      timeoutMs: spec.runtime.timeoutMs,
      retryCount: spec.runtime.retryCount,
      maxSteps: spec.runtime.maxSteps,
      viewport: spec.runtime.viewport
    };
    emitExperimentLog(input.onLog, `[explore] Model ${modelIndex + 1}/${models.length}: ${model.id} started`);
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
      emitExperimentLog(
        input.onLog,
        `[explore] Trial ${trial}/${spec.trials} for ${model.id}: autonomous exploration started in a fresh workspace`
      );
      const explorationWorkspace = await prepareRunWorkspace({
        resolvedSuite,
        runId: `${runId}-model-${modelIndex + 1}-trial-${trial}-explore`,
        resultsRoot
      });
      let explorationAutHandle: Awaited<ReturnType<typeof startAut>> | undefined;
      let explorationArtifact;
      try {
        explorationAutHandle = await startAut(explorationWorkspace.aut);
        explorationArtifact = await exploreTarget({
          model,
          trial,
          targetId: input.appId,
          bugIds: [],
          prompt: explorationPrompt,
          aut: explorationWorkspace.aut,
          runConfig,
          cacheConfig: exploreCacheConfig,
          workspacePath: explorationWorkspace.workspacePath
        });
      } finally {
        await explorationAutHandle?.stop();
      }

      await persistRunExplorationArtifacts(resultsRoot, runId, explorationArtifact);
      emitExperimentLog(
        input.onLog,
        `[explore] Trial ${trial}/${spec.trials} for ${model.id}: exploration captured ${explorationArtifact.summary.statesDiscovered} state(s), ${explorationArtifact.summary.transitionsDiscovered} transition(s), ${explorationArtifact.summary.actionsCached} action(s)`
      );

      const capabilityDiscovery: ExploreCapabilityDiscovery[] = capabilityIds.map((capabilityId) => {
        const capability = benchmark.capabilityMap.get(capabilityId)!;
        const discoveredScenarios = capability.scenarioIds.map((scenarioId) => {
          const scenario = benchmark.scenarios.get(scenarioId)!;
          const discovery = discoverScenario(
            scenario,
            explorationArtifact.actionCache,
            explorationArtifact.pages.length > 0
          );
          return {
            scenarioId,
            ...discovery
          };
        });
        return {
          capabilityId,
          title: capability.title,
          trial,
          discovered: discoveredScenarios.length > 0 && discoveredScenarios.every((item) => item.discovered),
          matchedScenarioIds: discoveredScenarios.filter((item) => item.discovered).map((item) => item.scenarioId),
          matchedStepIds: unique(discoveredScenarios.flatMap((item) => item.matchedStepIds)),
          matchedActionIds: unique(discoveredScenarios.flatMap((item) => item.matchedActionIds))
        };
      });

      emitExperimentLog(
        input.onLog,
        `[explore] Trial ${trial}/${spec.trials} for ${model.id}: probe replay started in a fresh workspace`
      );
      const probeWorkspace = await prepareRunWorkspace({
        resolvedSuite,
        runId: `${runId}-model-${modelIndex + 1}-trial-${trial}-probe`,
        resultsRoot
      });
      let probeAutHandle: Awaited<ReturnType<typeof startAut>> | undefined;
      let probeExecution;
      try {
        probeAutHandle = await startAut(probeWorkspace.aut);
        probeExecution = await executeGuidedScenarios({
          runId: `${runId}-model-${modelIndex + 1}-trial-${trial}-probe`,
          resultsRoot,
          resolvedSuite,
          workspace: probeWorkspace,
          model,
          runner,
          trial,
          usagePhase: "probe_replay",
          systemPrompt: resolvedSuite.prompts.guided,
          scenarioIds: spec.probeScenarioIds,
          onLog: input.onLog,
          scenarioLabel: `[explore][${model.id}][trial ${trial}] probe scenario`
        });
      } finally {
        await probeAutHandle?.stop();
      }

      probeScenarioRuns.push(...probeExecution.scenarioRuns);
      const probeSummary = summarizeScenarioRuns(probeExecution.scenarioRuns);
      const passedProbeScenarios = probeExecution.scenarioRuns.filter((scenarioRun) => scenarioRun.success).length;
      emitExperimentLog(
        input.onLog,
        `[explore] Trial ${trial}/${spec.trials} for ${model.id}: probe replay completed with ${passedProbeScenarios}/${probeExecution.scenarioRuns.length} scenario(s) passing`
      );
      const probeRuns: ExploreProbeRun[] = probeExecution.scenarioRuns.map((scenarioRun) => ({
        trial,
        scenarioId: scenarioRun.scenarioId,
        success: scenarioRun.success,
        matchedActionIds: [],
        scenarioRun
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

    const metrics = computeModelMetrics({
      model,
      trials,
      heuristicTargets: spec.heuristicTargets
    });
    const summary = {
      model,
      metrics,
      probeCacheSummary: summarizeScenarioRunCache(probeScenarioRuns),
      trials
    } satisfies ExploreModelSummary;
    emitExperimentLog(
      input.onLog,
      `[explore] Model ${model.id} completed: score ${metrics.score.toFixed(3)}, discovery ${(metrics.capabilityDiscoveryRate * 100).toFixed(1)}%, probe replay ${(metrics.probeReplayPassRate * 100).toFixed(1)}%`
    );
    return summary;
  });

  const artifact: ExploreRunArtifact = {
    kind: "explore",
    runId,
    appId: input.appId,
    startedAt,
    finishedAt: nowIso(),
    spec,
    modelSummaries
  };

  const output = await persistExploreOutput(resultsRoot, artifact, buildReport(artifact));
  emitExperimentLog(
    input.onLog,
    `[explore] Completed ${runId} in ${formatDurationMs(Date.now() - runStartedAtMs)}. Report: ${output.reportPath}`
  );
  return output;
}

export async function getExploreReport(runId: string, resultsDir = "results"): Promise<ExploreReport> {
  const reportsRoot = await resolveExperimentRoot(resultsDir, "explore");
  const raw = await readFile(join(reportsRoot, "runs", runId, "run.json"), "utf8");
  return buildReport(JSON.parse(raw) as ExploreRunArtifact);
}

export function buildExploreComparison(reports: Array<{ section: BenchmarkComparisonSection }>): ModeComparisonBuildResult {
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

  return {
    aggregateLeaderboard,
    modeSection
  };
}

export async function compareExploreRuns(runIds: string[], resultsDir = "results"): Promise<CompareResult<ExploreReport>> {
  const reports = await Promise.all(runIds.map((runId) => getExploreReport(runId, resultsDir)));
  const { aggregateLeaderboard, modeSection } = buildExploreComparison(reports);
  const finalReport = await persistComparisonReport({
    title: "Explore Mode Comparison",
    subtitle: `Matrix comparison across ${reports.length} exploration run(s).`,
    runIds,
    modeSections: [modeSection],
    resultsDir,
    prefix: "explore-compare",
    stableName: "explore-compare-latest"
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
