import type { AiCostSource, AiUsageRecord, AiUsageSummary, UsageCostSummary } from "../types.js";

function roundCost(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function resolveCostSource(summaries: Array<AiUsageSummary | undefined>): AiCostSource {
  let sawEstimated = false;

  for (const summary of summaries) {
    if (!summary) {
      continue;
    }

    if (summary.costSource === "unavailable") {
      return "unavailable";
    }

    if (summary.costSource === "estimated") {
      sawEstimated = true;
    }
  }

  return sawEstimated ? "estimated" : "exact";
}

export function emptyAiUsageSummary(costSource: AiCostSource = "exact"): AiUsageSummary {
  return {
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    resolvedCostUsd: 0,
    costSource,
    callCount: 0,
    unavailableCalls: 0
  };
}

export function summarizeAiUsage(records: AiUsageRecord[]): AiUsageSummary {
  if (records.length === 0) {
    return emptyAiUsageSummary("exact");
  }

  const unavailableCalls = records.filter((record) => record.costSource === "unavailable").length;
  const costSource: AiCostSource = unavailableCalls > 0 ? "unavailable" : records.some((record) => record.costSource === "estimated") ? "estimated" : "exact";
  const resolvedCostUsd = roundCost(records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0));

  return {
    latencyMs: records.reduce((sum, record) => sum + record.latencyMs, 0),
    inputTokens: records.reduce((sum, record) => sum + record.inputTokens, 0),
    outputTokens: records.reduce((sum, record) => sum + record.outputTokens, 0),
    reasoningTokens: records.reduce((sum, record) => sum + record.reasoningTokens, 0),
    cachedInputTokens: records.reduce((sum, record) => sum + record.cachedInputTokens, 0),
    totalTokens: records.reduce((sum, record) => sum + record.totalTokens, 0),
    costUsd: costSource === "unavailable" ? undefined : resolvedCostUsd,
    resolvedCostUsd,
    costSource,
    callCount: records.length,
    unavailableCalls
  };
}

export function sumAiUsageSummaries(summaries: Array<AiUsageSummary | undefined>): AiUsageSummary {
  const filtered = summaries.filter((summary): summary is AiUsageSummary => Boolean(summary));
  if (filtered.length === 0) {
    return emptyAiUsageSummary("exact");
  }

  const costSource = resolveCostSource(filtered);
  const resolvedCostUsd = roundCost(filtered.reduce((sum, summary) => sum + (summary.resolvedCostUsd ?? summary.costUsd ?? 0), 0));

  return {
    latencyMs: filtered.reduce((sum, summary) => sum + summary.latencyMs, 0),
    inputTokens: filtered.reduce((sum, summary) => sum + summary.inputTokens, 0),
    outputTokens: filtered.reduce((sum, summary) => sum + summary.outputTokens, 0),
    reasoningTokens: filtered.reduce((sum, summary) => sum + summary.reasoningTokens, 0),
    cachedInputTokens: filtered.reduce((sum, summary) => sum + summary.cachedInputTokens, 0),
    totalTokens: filtered.reduce((sum, summary) => sum + summary.totalTokens, 0),
    costUsd: costSource === "unavailable" ? undefined : resolvedCostUsd,
    resolvedCostUsd,
    costSource,
    callCount: filtered.reduce((sum, summary) => sum + (summary.callCount ?? 0), 0),
    unavailableCalls: filtered.reduce((sum, summary) => sum + (summary.unavailableCalls ?? 0), 0)
  };
}

export function formatUsageCost(summary: AiUsageSummary | undefined, fallback = 0): string {
  if (!summary) {
    return `$${fallback.toFixed(4)} (estimated)`;
  }

  if (summary.costSource === "unavailable") {
    const resolved = summary.resolvedCostUsd ?? summary.costUsd ?? 0;
    return resolved > 0 ? `$${resolved.toFixed(4)} (partial)` : "Unavailable";
  }

  const resolved = summary.resolvedCostUsd ?? summary.costUsd ?? 0;
  return `$${resolved.toFixed(4)}${summary.costSource === "estimated" ? " (estimated)" : ""}`;
}

export function summarizeUsageCosts(
  summaries: Array<AiUsageSummary | undefined>,
  units: number
): UsageCostSummary {
  const aggregate = sumAiUsageSummaries(summaries);
  const safeUnits = units > 0 ? units : 1;
  return {
    avgResolvedUsd: roundCost((aggregate.resolvedCostUsd ?? aggregate.costUsd ?? 0) / safeUnits),
    totalResolvedUsd: roundCost(aggregate.resolvedCostUsd ?? aggregate.costUsd ?? 0),
    costSource: aggregate.costSource,
    callCount: aggregate.callCount ?? 0,
    unavailableCalls: aggregate.unavailableCalls ?? 0
  };
}
