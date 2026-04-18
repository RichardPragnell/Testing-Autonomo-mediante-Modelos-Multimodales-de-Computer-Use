import { clamp, round } from "./common.js";
import type { BenchmarkScoreDefinition } from "./types.js";

export const QA_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Guided mode rewards end-to-end scenario completion first, then step quality and consistency.",
  formula:
    "Score = 100 x clamp(0.45 x Scenario Completion + 0.25 x Step Pass + 0.15 x Capability Pass + 0.15 x Stability)",
  metrics: [
    {
      key: "scenarioCompletionRate",
      label: "Scenario Completion",
      weight: 0.45,
      description: "Share of guided scenario runs that completed successfully.",
      contribution: "Largest term because a full journey should outrank isolated successful steps."
    },
    {
      key: "stepPassRate",
      label: "Step Pass",
      weight: 0.25,
      description: "Share of scenario steps that passed across all executed guided scenario runs.",
      contribution: "Captures granular journey quality even when full scenarios are not completed."
    },
    {
      key: "capabilityPassRate",
      label: "Capability Pass",
      weight: 0.15,
      description: "Share of benchmark capabilities whose grouped scenarios all passed.",
      contribution: "Rewards breadth across benchmark capabilities instead of repeated success on one narrow path."
    },
    {
      key: "stability",
      label: "Stability",
      weight: 0.15,
      description: "Consistency score normalized to the full 0-1 range from run-to-run variance in binary scenario outcomes.",
      contribution: "Rewards repeatable behavior and more strongly penalizes unstable models than the previous scaling."
    }
  ],
  specialRules: [
    "Stability = 1 - (average binary standard deviation / 0.5), clamped to the 0-1 range.",
    "Higher score is better; the final score is clamped to the 0-100 range after weighting."
  ]
};

export const EXPLORE_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Explore mode rewards useful coverage first, then replay utility.",
  formula:
    "Score = 100 x clamp(0.35 x Capability Discovery + 0.20 x State Coverage + 0.15 x Transition Coverage + 0.10 x Action Diversity + 0.20 x Probe Replay)",
  metrics: [
    {
      key: "capabilityDiscoveryRate",
      label: "Capability Discovery",
      weight: 0.35,
      description: "Share of benchmark capabilities that autonomous exploration surfaced.",
      contribution: "Primary exploration objective because discovery quality matters more than wandering volume."
    },
    {
      key: "stateCoverage",
      label: "State Coverage",
      weight: 0.2,
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
      weight: 0.1,
      description: "Fraction of expected action kinds covered by the exploration trace.",
      contribution: "Small bonus for varied exploration behavior after the primary coverage objectives have been met."
    },
    {
      key: "probeReplayPassRate",
      label: "Probe Replay",
      weight: 0.2,
      description: "Share of guided probe scenarios that pass when replayed from exploration artifacts.",
      contribution: "Measures whether exploration found reusable journeys instead of only novel traces."
    }
  ],
  specialRules: ["State and transition coverage are capped at 1.0 after normalizing against the heuristic targets."]
};

export const HEAL_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Self-heal mode rewards complete scenario-level repairs first, then regression safety and diagnostic accuracy.",
  formula:
    "Score = 100 x clamp(0.35 x Fix Rate + 0.30 x Failing-Scenario Fix + 0.15 x Regression-Free + 0.10 x Validation Pass + 0.10 x Localization Recall)",
  metrics: [
    {
      key: "fixRate",
      label: "Fix Rate",
      weight: 0.35,
      description: "Share of repair cases that validate, fully fix the failing tasks, and avoid regressions.",
      contribution: "Primary signal because it captures end-to-end repair success at the case level."
    },
    {
      key: "failingScenarioFixRate",
      label: "Failing-Scenario Fix",
      weight: 0.3,
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
    }
  ],
  specialRules: [
    "Patch Apply is still reported operationally, but it is excluded from the weighted score.",
    "Localization Recall = |suspected files intersect gold files| / |gold files|."
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
    input.scenarioCompletionRate * 0.45 +
    input.stepPassRate * 0.25 +
    input.capabilityPassRate * 0.15 +
    input.stability * 0.15;
  void input.avgLatencyMs;
  void input.avgCostUsd;
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
    input.capabilityDiscoveryRate * 0.35 +
    input.stateCoverage * 0.2 +
    input.transitionCoverage * 0.15 +
    input.actionDiversity * 0.1 +
    input.probeReplayPassRate * 0.2;
  void input.avgLatencyMs;
  void input.avgCostUsd;
  return round(clamp(weighted) * 100, 3);
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
    input.fixRate * 0.35 +
    input.failingScenarioFixRate * 0.3 +
    input.regressionFreeRate * 0.15 +
    input.validationPassRate * 0.1 +
    input.localizationAccuracy * 0.1;

  void input.patchApplyRate;
  void input.avgLatencyMs;
  void input.avgCostUsd;
  return round(clamp(weighted) * 100, 3);
}
