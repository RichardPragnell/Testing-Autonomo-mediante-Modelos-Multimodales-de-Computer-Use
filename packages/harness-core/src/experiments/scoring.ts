import { clamp, computeCostEfficiency, computeLatencyEfficiency, round } from "./common.js";
import type { BenchmarkScoreDefinition } from "./types.js";

export const QA_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Guided mode rewards end-to-end task completion first, then consistency and efficiency.",
  formula:
    "Score = 100 x clamp(0.45 x Scenario Completion + 0.25 x Task Pass + 0.15 x Capability Pass + 0.10 x Stability + 0.03 x Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "fullScenarioCompletionRate",
      label: "Scenario Completion",
      weight: 0.45,
      description: "Share of trials where every guided task in the scenario succeeded.",
      contribution: "Largest term because partial task success should not outrank a fully completed run."
    },
    {
      key: "taskPassRate",
      label: "Task Pass",
      weight: 0.25,
      description: "Share of guided tasks that passed across all executed trials.",
      contribution: "Captures granular task execution quality even when full scenarios are not completed."
    },
    {
      key: "capabilityPassRate",
      label: "Capability Pass",
      weight: 0.15,
      description: "Share of benchmark capabilities whose grouped tasks all passed.",
      contribution: "Rewards breadth across benchmark capabilities instead of repeated success on one narrow path."
    },
    {
      key: "stability",
      label: "Stability",
      weight: 0.1,
      description: "Consistency score derived from run-to-run variance in binary task outcomes.",
      contribution: "Rewards repeatable behavior; unstable models lose score even if single runs look strong."
    },
    {
      key: "latencyEfficiency",
      label: "Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average latency using the shared latency pivot.",
      contribution: "Small bonus that separates otherwise similar guided results in favor of faster runs."
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
    "Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05).",
    "Higher score is better; the final score is clamped to the 0-100 range after weighting."
  ]
};

export const EXPLORE_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Explore mode rewards discovering useful coverage first, with replay and efficiency as secondary terms.",
  formula:
    "Score = 100 x clamp(0.30 x Capability Discovery + 0.25 x State Coverage + 0.20 x Transition Coverage + 0.15 x Probe Replay + 0.05 x Action Diversity + 0.03 x Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "capabilityDiscoveryRate",
      label: "Capability Discovery",
      weight: 0.3,
      description: "Share of benchmark capabilities that autonomous exploration surfaced.",
      contribution: "Primary exploration objective because discovery quality matters more than wandering volume."
    },
    {
      key: "stateCoverage",
      label: "State Coverage",
      weight: 0.25,
      description: "Observed state count normalized against the configured minimum target.",
      contribution: "Rewards breadth of reachable UI states without overvaluing redundant steps."
    },
    {
      key: "transitionCoverage",
      label: "Transition Coverage",
      weight: 0.2,
      description: "Observed state-transition count normalized against the configured minimum target.",
      contribution: "Rewards meaningful navigation through the app rather than isolated snapshots."
    },
    {
      key: "probeReplayPassRate",
      label: "Probe Replay",
      weight: 0.15,
      description: "Share of guided probe tasks that pass when replayed from exploration artifacts.",
      contribution: "Measures whether exploration found reusable actions instead of only novel traces."
    },
    {
      key: "actionDiversity",
      label: "Action Diversity",
      weight: 0.05,
      description: "Fraction of expected action kinds covered by the exploration trace.",
      contribution: "Small bonus for varied exploration behavior once discovery and coverage are already strong."
    },
    {
      key: "latencyEfficiency",
      label: "Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average latency using the shared latency pivot.",
      contribution: "Small bonus that favors faster exploration runs when outcome metrics are close."
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
    "Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05)."
  ]
};

export const HEAL_SCORE_DEFINITION: BenchmarkScoreDefinition = {
  modeDescription: "Self-heal mode rewards fixing the failing tasks without regressions, then discounts patch-only outcomes through a fix-rate gate.",
  formula:
    "Base = 0.40 x Failing-Task Fix + 0.20 x Regression-Free + 0.15 x Validation Pass + 0.10 x Localization + 0.05 x Patch Apply; Gated Outcome = Base x (0.5 + 0.5 x Failing-Task Fix); Score = 100 x clamp(Gated Outcome + 0.03 x Latency Efficiency + 0.02 x Cost Efficiency)",
  metrics: [
    {
      key: "failingTaskFixRate",
      label: "Failing-Task Fix",
      weight: 0.4,
      description: "Average fraction of originally failing benchmark tasks fixed after the patch.",
      contribution: "Dominant term because successful repair is the main objective of self-heal."
    },
    {
      key: "regressionFreeRate",
      label: "Regression-Free",
      weight: 0.2,
      description: "Average fraction of regression checks that still pass after the patch.",
      contribution: "Second-largest term to prevent fixes that break previously healthy behavior."
    },
    {
      key: "validationPassRate",
      label: "Validation Pass",
      weight: 0.15,
      description: "Share of repair cases where the validation command completed successfully.",
      contribution: "Rewards patches that survive the benchmark’s validation gate."
    },
    {
      key: "localizationAccuracy",
      label: "Localization",
      weight: 0.1,
      description: "Average overlap between suspected files and gold touched files for the seeded bug.",
      contribution: "Rewards accurate diagnosis, but less than actual repair outcomes."
    },
    {
      key: "patchApplyRate",
      label: "Patch Apply",
      weight: 0.05,
      description: "Share of repair attempts whose generated patch applied cleanly.",
      contribution: "Small bonus for operational patch quality after diagnosis."
    },
    {
      key: "latencyEfficiency",
      label: "Latency Efficiency",
      weight: 0.03,
      description: "Efficiency term computed from average latency using the shared latency pivot.",
      contribution: "Small bonus that favors faster repair cycles when repair quality is similar."
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
    "The base repair outcome is multiplied by (0.5 + 0.5 x Failing-Task Fix), so patch-only results are gated down.",
    "Latency Efficiency = 1 / (1 + avgLatencyMs / 2000).",
    "Cost Efficiency = 1 / (1 + avgCostUsd / 0.05)."
  ]
};

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
