import { clamp, computeCostEfficiency, computeLatencyEfficiency, round } from "./common.js";

export function computeQaScore(input: {
  capabilityPassRate: number;
  fullScenarioCompletionRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.capabilityPassRate * 0.45 +
    input.fullScenarioCompletionRate * 0.2 +
    input.stability * 0.15 +
    computeLatencyEfficiency(input.avgLatencyMs) * 0.1 +
    computeCostEfficiency(input.avgCostUsd) * 0.1;
  return round(clamp(weighted) * 100, 3);
}

export function computeExploreScore(input: {
  capabilityDiscoveryRate: number;
  probeReplayPassRate: number;
  stateCoverage: number;
  transitionCoverage: number;
  actionDiversity: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.capabilityDiscoveryRate * 0.3 +
    input.probeReplayPassRate * 0.3 +
    input.stateCoverage * 0.15 +
    input.transitionCoverage * 0.15 +
    input.actionDiversity * 0.1;
  const efficiencyPenalty =
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 + computeCostEfficiency(input.avgCostUsd) * 0.02;
  return round(clamp(weighted + efficiencyPenalty) * 100, 3);
}

export function computeHealScore(input: {
  localizationAccuracy: number;
  patchApplyRate: number;
  validationPassRate: number;
  failingTaskFixRate: number;
  regressionFreeRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.localizationAccuracy * 0.2 +
    input.patchApplyRate * 0.1 +
    input.validationPassRate * 0.15 +
    input.failingTaskFixRate * 0.25 +
    input.regressionFreeRate * 0.2 +
    computeLatencyEfficiency(input.avgLatencyMs) * 0.05 +
    computeCostEfficiency(input.avgCostUsd) * 0.05;
  return round(clamp(weighted) * 100, 3);
}
