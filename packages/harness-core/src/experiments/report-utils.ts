import type { AiCostSource, UsageCostSummary } from "../types.js";

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

export function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function mergeCostSources(sources: AiCostSource[]): AiCostSource {
  if (sources.includes("unavailable")) {
    return "unavailable";
  }
  if (sources.includes("estimated")) {
    return "estimated";
  }
  return "exact";
}

export function aggregateCostSummaries(summaries: UsageCostSummary[], units: number): UsageCostSummary {
  const totalResolvedUsd = round(summaries.reduce((sum, summary) => sum + summary.totalResolvedUsd, 0));
  const safeUnits = units > 0 ? units : 1;
  return {
    avgResolvedUsd: round(totalResolvedUsd / safeUnits),
    totalResolvedUsd,
    costSource: mergeCostSources(summaries.map((summary) => summary.costSource)),
    callCount: summaries.reduce((sum, summary) => sum + summary.callCount, 0),
    unavailableCalls: summaries.reduce((sum, summary) => sum + summary.unavailableCalls, 0)
  };
}

export function formatCostSummary(
  summary: UsageCostSummary,
  field: "avgResolvedUsd" | "totalResolvedUsd"
): string {
  const value = summary[field];
  if (summary.costSource === "unavailable") {
    return value > 0 ? `$${value.toFixed(4)} (partial)` : "Unavailable";
  }
  if (summary.costSource === "estimated") {
    return `$${value.toFixed(4)} (estimated)`;
  }
  return `$${value.toFixed(4)}`;
}

export function formatCostSource(summary: UsageCostSummary): string {
  if (summary.costSource === "unavailable") {
    return summary.totalResolvedUsd > 0 ? "Partial exact coverage" : "Unavailable";
  }
  if (summary.costSource === "estimated") {
    return "Estimated";
  }
  return "Exact";
}
