import { clamp, computeCostEfficiency, computeLatencyEfficiency, round } from "./common.js";

export function computeQaScore(input: {
  capabilityPassRate: number;
  fullScenarioCompletionRate: number;
  taskPassRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.fullScenarioCompletionRate * 0.45 +
    input.taskPassRate * 0.25 +
    input.capabilityPassRate * 0.15 +
    input.stability * 0.1 +
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 +
    computeCostEfficiency(input.avgCostUsd) * 0.02;
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
    input.stateCoverage * 0.25 +
    input.transitionCoverage * 0.2 +
    input.probeReplayPassRate * 0.15 +
    input.actionDiversity * 0.05;
  const efficiencyBonus =
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 + computeCostEfficiency(input.avgCostUsd) * 0.02;
  return round(clamp(weighted + efficiencyBonus) * 100, 3);
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
  const base =
    input.failingTaskFixRate * 0.4 +
    input.regressionFreeRate * 0.2 +
    input.validationPassRate * 0.15 +
    input.localizationAccuracy * 0.1 +
    input.patchApplyRate * 0.05;
  const gatedOutcome = base * (0.5 + 0.5 * input.failingTaskFixRate);
  const efficiencyBonus =
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 + computeCostEfficiency(input.avgCostUsd) * 0.02;
  return round(clamp(gatedOutcome + efficiencyBonus) * 100, 3);
}
