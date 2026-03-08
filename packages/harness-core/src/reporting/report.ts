import type { BenchmarkReport, Finding, LeaderboardEntry, ModelRunSummary, RepairAttempt } from "../types.js";
import { nowIso } from "../utils/time.js";

export function buildLeaderboard(summaries: ModelRunSummary[]): LeaderboardEntry[] {
  return [...summaries]
    .sort((a, b) => b.metrics.score - a.metrics.score)
    .map((summary, index) => ({
      rank: index + 1,
      modelId: summary.model.id,
      provider: summary.model.provider,
      score: summary.metrics.score,
      passRate: summary.metrics.passRate,
      stability: summary.metrics.stability,
      avgLatencyMs: summary.metrics.avgLatencyMs,
      avgCostUsd: summary.metrics.avgCostUsd
    }));
}

export function clusterFailures(findings: Finding[]): BenchmarkReport["failureClusters"] {
  const clusters: BenchmarkReport["failureClusters"] = {
    navigation: 0,
    locator: 0,
    state: 0,
    assertion: 0,
    timeout: 0,
    unexpected_ui: 0,
    unknown: 0
  };
  for (const finding of findings) {
    clusters[finding.category] += 1;
  }
  return clusters;
}

export function summarizeRepairs(repairs: RepairAttempt[]): BenchmarkReport["repairOutcomes"] {
  const base = { fixed: 0, not_fixed: 0, regression: 0, skipped: 0 };
  for (const attempt of repairs) {
    base[attempt.outcome] += 1;
  }
  return base;
}

export function buildBenchmarkReport(input: {
  runId: string;
  suiteId: string;
  targetId: string;
  scenarioIds: string[];
  bugIds: string[];
  explorationMode: BenchmarkReport["explorationMode"];
  modelSummaries: ModelRunSummary[];
  findings: Finding[];
  repairs: RepairAttempt[];
}): BenchmarkReport {
  const leaderboard = buildLeaderboard(input.modelSummaries);
  const confidence = Object.fromEntries(
    input.modelSummaries.map((summary) => [summary.model.id, summary.metrics.confidence95])
  );
  return {
    runId: input.runId,
    suiteId: input.suiteId,
    targetId: input.targetId,
    scenarioIds: input.scenarioIds,
    bugIds: input.bugIds,
    explorationMode: input.explorationMode,
    generatedAt: nowIso(),
    leaderboard,
    confidence,
    failureClusters: clusterFailures(input.findings),
    repairOutcomes: summarizeRepairs(input.repairs)
  };
}

export const buildExperimentReport = buildBenchmarkReport;
