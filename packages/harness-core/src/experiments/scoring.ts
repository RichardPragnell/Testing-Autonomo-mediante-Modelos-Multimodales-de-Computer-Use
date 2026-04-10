import { clamp, computeCostEfficiency, computeLatencyEfficiency, round } from "./common.js";
import type { BenchmarkScoreDefinition } from "./types.js";

export const QA_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Guided mode rewards end-to-end scenario completion first, then step quality, consistency, and efficiency.",
  formula:
    "Score = 100 x clamp(0.44 x Scenario Completion + 0.24 x Step Pass + 0.12 x Capability Pass + 0.15 x Stability + 0.03 x Run Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "scenarioCompletionRate",
      label: "Scenario Completion",
      weight: 0.44,
      description: "Share of guided scenario runs that completed successfully.",
      contribution: "Largest term because a full journey should outrank isolated successful steps."
    },
    {
      key: "stepPassRate",
      label: "Step Pass",
      weight: 0.24,
      description: "Share of scenario steps that passed across all executed guided scenario runs.",
      contribution: "Captures granular journey quality even when full scenarios are not completed."
    },
    {
      key: "capabilityPassRate",
      label: "Capability Pass",
      weight: 0.12,
      description: "Share of benchmark capabilities whose grouped scenarios all passed.",
      contribution: "Rewards breadth across benchmark capabilities instead of repeated success on one narrow path."
    },
    {
      key: "stability",
      label: "Stability",
      weight: 0.15,
      description: "Consistency score normalized to the full 0-1 range from run-to-run variance in binary scenario outcomes.",
      contribution: "Rewards repeatable behavior and more strongly penalizes unstable models than the previous scaling."
    },
    {
      key: "latencyEfficiency",
      label: "Run Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average run latency using the shared latency pivot.",
      contribution: "Small bonus that separates otherwise similar guided results in favor of lower-latency runs."
    },
    {
      key: "costEfficiency",
      label: "Cost Efficiency",
      weight: 0.02,
      description: "Efficiency term computed from average resolved cost using the shared cost pivot.",
      contribution: "Small bonus that favors cheaper guided runs without dominating correctness."
    }
  ],
  specialRules: [
    "Stability = 1 - (average binary standard deviation / 0.5), clamped to the 0-1 range.",
    "Run Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05).",
    "Higher score is better; the final score is clamped to the 0-100 range after weighting."
  ]
};

export const EXPLORE_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Explore mode rewards useful coverage first, then replay utility and operational efficiency.",
  formula:
    "Score = 100 x clamp(0.3375 x Capability Discovery + 0.1875 x State Coverage + 0.15 x Transition Coverage + 0.075 x Action Diversity + 0.20 x Probe Replay + 0.03 x Run Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "capabilityDiscoveryRate",
      label: "Capability Discovery",
      weight: 0.3375,
      description: "Share of benchmark capabilities that autonomous exploration surfaced.",
      contribution: "Primary exploration objective because discovery quality matters more than wandering volume."
    },
    {
      key: "stateCoverage",
      label: "State Coverage",
      weight: 0.1875,
      description: "Observed state count normalized against the configured minimum target.",
      contribution: "Rewards breadth of reachable UI states without overvaluing redundant steps."
    },
    {
      key: "transitionCoverage",
      label: "Transition Coverage",
      weight: 0.15,
      description: "Observed state-transition count normalized against the configured minimum target.",
      contribution: "Rewards meaningful navigation through the app rather than isolated snapshots."
    },
    {
      key: "actionDiversity",
      label: "Action Diversity",
      weight: 0.075,
      description: "Fraction of expected action kinds covered by the exploration trace.",
      contribution: "Small bonus for varied exploration behavior after the primary coverage objectives have been met."
    },
    {
      key: "probeReplayPassRate",
      label: "Probe Replay",
      weight: 0.2,
      description: "Share of guided probe scenarios that pass when replayed from exploration artifacts.",
      contribution: "Measures whether exploration found reusable journeys instead of only novel traces."
    },
    {
      key: "latencyEfficiency",
      label: "Run Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average run latency using the shared latency pivot.",
      contribution: "Small bonus that favors lower-latency exploration runs when outcome metrics are close."
    },
    {
      key: "costEfficiency",
      label: "Cost Efficiency",
      weight: 0.02,
      description: "Efficiency term computed from average resolved cost using the shared cost pivot.",
      contribution: "Small bonus that favors cheaper exploration runs without overpowering coverage."
    }
  ],
  specialRules: [
    "State and transition coverage are capped at 1.0 after normalizing against the heuristic targets.",
    "Run Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05)."
  ]
};

export const HEAL_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Self-heal mode rewards complete scenario-level repairs first, then regression safety and diagnostic accuracy.",
  formula:
    "Score = 100 x clamp(0.33 x Fix Rate + 0.27 x Failing-Scenario Fix + 0.15 x Regression-Free + 0.10 x Validation Pass + 0.10 x Localization Recall + 0.03 x Run Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "fixRate",
      label: "Fix Rate",
      weight: 0.33,
      description: "Share of repair cases that validate, fully fix the failing tasks, and avoid regressions.",
      contribution: "Primary signal because it captures end-to-end repair success at the case level."
    },
    {
      key: "failingScenarioFixRate",
      label: "Failing-Scenario Fix",
      weight: 0.27,
      description: "Average fraction of originally failing benchmark scenarios fixed after the patch.",
      contribution: "Captures partial repair quality when full case resolution has not yet been reached."
    },
    {
      key: "regressionFreeRate",
      label: "Regression-Free",
      weight: 0.15,
      description: "Average fraction of regression checks that still pass after the patch.",
      contribution: "Prevents apparently strong repairs from ranking well if they damage previously healthy behavior."
    },
    {
      key: "validationPassRate",
      label: "Validation Pass",
      weight: 0.1,
      description: "Share of repair cases where the validation command completed successfully.",
      contribution: "Rewards repairs that clear the explicit verification gate."
    },
    {
      key: "localizationAccuracy",
      label: "Localization Recall",
      weight: 0.1,
      description: "Average recall of gold touched files recovered by the suspected-file set for the seeded bug.",
      contribution: "Rewards accurate diagnosis, but less than actual repair outcomes."
    },
    {
      key: "latencyEfficiency",
      label: "Run Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average run latency using the shared latency pivot.",
      contribution: "Small bonus that favors lower-latency repair cycles when repair quality is similar."
    },
    {
      key: "costEfficiency",
      label: "Cost Efficiency",
      weight: 0.02,
      description: "Efficiency term computed from average resolved cost using the shared cost pivot.",
      contribution: "Small bonus that favors cheaper repair cycles without outranking actual fixes."
    }
  ],
  specialRules: [
    "Patch Apply is still reported operationally, but it is excluded from the weighted score.",
    "Localization Recall = |suspected files intersect gold files| / |gold files|.",
    "Run Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05)."
  ]
};

export function computeQaScore(input: {
  capabilityPassRate: number;
  scenarioCompletionRate: number;
  stepPassRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.scenarioCompletionRate * 0.44 +
    input.stepPassRate * 0.24 +
    input.capabilityPassRate * 0.12 +
    input.stability * 0.15 +
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
    input.capabilityDiscoveryRate * 0.3375 +
    input.stateCoverage * 0.1875 +
    input.transitionCoverage * 0.15 +
    input.actionDiversity * 0.075 +
    input.probeReplayPassRate * 0.2;
  const efficiencyBonus =
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 + computeCostEfficiency(input.avgCostUsd) * 0.02;
  return round(clamp(weighted + efficiencyBonus) * 100, 3);
}

export function computeHealScore(input: {
  fixRate: number;
  localizationAccuracy: number;
  patchApplyRate: number;
  validationPassRate: number;
  failingScenarioFixRate: number;
  regressionFreeRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const weighted =
    input.fixRate * 0.33 +
    input.failingScenarioFixRate * 0.27 +
    input.regressionFreeRate * 0.15 +
    input.validationPassRate * 0.1 +
    input.localizationAccuracy * 0.1;
  const efficiencyBonus =
    computeLatencyEfficiency(input.avgLatencyMs) * 0.03 + computeCostEfficiency(input.avgCostUsd) * 0.02;

  void input.patchApplyRate;
  return round(clamp(weighted + efficiencyBonus) * 100, 3);
}
