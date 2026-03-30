import type { AiCostSource, UsageCostSummary } from "../types.js";

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

export function formatCostSummary(
  summary: UsageCostSummary,
  field: "avgResolvedUsd" | "totalResolvedUsd"
): string {
  if (summary.callCount === 0) {
    return "No AI calls";
  }
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
  if (summary.callCount === 0) {
    return "No AI calls";
  }
  if (summary.costSource === "unavailable") {
    return summary.totalResolvedUsd > 0 ? "Partial exact coverage" : "Unavailable";
  }
  if (summary.costSource === "estimated") {
    return "Estimated";
  }
  return "Exact";
}
