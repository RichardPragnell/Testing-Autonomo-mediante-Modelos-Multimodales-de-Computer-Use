import { describe, expect, it } from "vitest";
import { computeBinaryStability } from "../../src/experiments/common.js";
import {
  computeExploreScore,
  computeHealScore,
  computeQaScore,
  EXPLORE_SCORE_DEFINITION,
  HEAL_SCORE_DEFINITION,
  QA_SCORE_DEFINITION
} from "../../src/experiments/scoring.js";

describe("experiment scoring", () => {
  it("exposes canonical score metadata for every experiment mode", () => {
    expect(QA_SCORE_DEFINITION.formula).toContain("0.45 x Scenario Completion");
    expect(QA_SCORE_DEFINITION.formula).not.toContain("Latency");
    expect(QA_SCORE_DEFINITION.formula).not.toContain("Cost");
    expect(QA_SCORE_DEFINITION.metrics.map((metric) => metric.label)).toContain("Stability");
    expect(QA_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("latencyEfficiency");
    expect(QA_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("costEfficiency");
    expect(EXPLORE_SCORE_DEFINITION.formula).toContain("0.35 x Capability Discovery");
    expect(EXPLORE_SCORE_DEFINITION.formula).not.toContain("Latency");
    expect(EXPLORE_SCORE_DEFINITION.formula).not.toContain("Cost");
    expect(EXPLORE_SCORE_DEFINITION.metrics.map((metric) => metric.label)).toContain("Probe Replay");
    expect(EXPLORE_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("latencyEfficiency");
    expect(EXPLORE_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("costEfficiency");
    expect(HEAL_SCORE_DEFINITION.formula).toContain("0.35 x Fix Rate");
    expect(HEAL_SCORE_DEFINITION.formula).not.toContain("Latency");
    expect(HEAL_SCORE_DEFINITION.formula).not.toContain("Cost");
    expect(HEAL_SCORE_DEFINITION.metrics.map((metric) => metric.label)).toContain("Localization Recall");
    expect(HEAL_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("latencyEfficiency");
    expect(HEAL_SCORE_DEFINITION.metrics.map((metric) => metric.key)).not.toContain("costEfficiency");
    expect(HEAL_SCORE_DEFINITION.specialRules.some((rule) => rule.includes("Patch Apply"))).toBe(true);
    expect(HEAL_SCORE_DEFINITION.specialRules.some((rule) => rule.includes("Localization Recall"))).toBe(true);
  });

  it("normalizes binary stability across the full 0-1 range", () => {
    expect(computeBinaryStability([[0, 0], [1, 1]])).toBe(1);
    expect(computeBinaryStability([[0, 1], [1, 0]])).toBe(0);
  });

  it("penalizes guided runs with zero scenario completion", () => {
    const weak = computeQaScore({
      capabilityPassRate: 0.9,
      scenarioCompletionRate: 0,
      stepPassRate: 0.9,
      stability: 0.9,
      avgLatencyMs: 800,
      avgCostUsd: 0.01
    });
    const strong = computeQaScore({
      capabilityPassRate: 0.9,
      scenarioCompletionRate: 1,
      stepPassRate: 0.9,
      stability: 0.9,
      avgLatencyMs: 800,
      avgCostUsd: 0.01
    });

    expect(weak).toBeLessThan(strong);
    expect(weak).toBeLessThan(60);
  });

  it("rewards lower QA instability after binary normalization", () => {
    const unstable = computeQaScore({
      capabilityPassRate: 1,
      scenarioCompletionRate: 1,
      stepPassRate: 1,
      stability: 0,
      avgLatencyMs: 0,
      avgCostUsd: 0
    });
    const stable = computeQaScore({
      capabilityPassRate: 1,
      scenarioCompletionRate: 1,
      stepPassRate: 1,
      stability: 1,
      avgLatencyMs: 0,
      avgCostUsd: 0
    });

    expect(unstable).toBeLessThan(stable);
    expect(unstable).toBeLessThan(90);
    expect(stable).toBe(100);
  });

  it("penalizes exploration runs with replay success but no discovery or coverage", () => {
    const weak = computeExploreScore({
      capabilityDiscoveryRate: 0,
      probeReplayPassRate: 1,
      stateCoverage: 0,
      transitionCoverage: 0,
      actionDiversity: 0,
      avgLatencyMs: 900,
      avgCostUsd: 0.005
    });
    const strong = computeExploreScore({
      capabilityDiscoveryRate: 1,
      probeReplayPassRate: 1,
      stateCoverage: 1,
      transitionCoverage: 1,
      actionDiversity: 1,
      avgLatencyMs: 900,
      avgCostUsd: 0.005
    });

    expect(weak).toBeLessThan(strong);
    expect(weak).toBeLessThan(25);
  });

  it("keeps successful repairs above patch-only repairs", () => {
    const patchOnly = computeHealScore({
      fixRate: 0,
      localizationAccuracy: 0.75,
      patchApplyRate: 1,
      validationPassRate: 0,
      failingScenarioFixRate: 0,
      regressionFreeRate: 0.8,
      avgLatencyMs: 1500,
      avgCostUsd: 0.02
    });
    const fixed = computeHealScore({
      fixRate: 1,
      localizationAccuracy: 0.75,
      patchApplyRate: 1,
      validationPassRate: 1,
      failingScenarioFixRate: 1,
      regressionFreeRate: 0.8,
      avgLatencyMs: 1500,
      avgCostUsd: 0.02
    });

    expect(fixed).toBeGreaterThan(patchOnly);
    expect(patchOnly).toBeLessThan(30);
    expect(fixed).toBeLessThanOrEqual(100);
  });

  it("ignores patch application when computing the weighted heal score", () => {
    const withPatch = computeHealScore({
      fixRate: 0.5,
      localizationAccuracy: 0.5,
      patchApplyRate: 1,
      validationPassRate: 0.5,
      failingScenarioFixRate: 0.5,
      regressionFreeRate: 0.5,
      avgLatencyMs: 500,
      avgCostUsd: 0.01
    });
    const withoutPatch = computeHealScore({
      fixRate: 0.5,
      localizationAccuracy: 0.5,
      patchApplyRate: 0,
      validationPassRate: 0.5,
      failingScenarioFixRate: 0.5,
      regressionFreeRate: 0.5,
      avgLatencyMs: 500,
      avgCostUsd: 0.01
    });

    expect(withPatch).toBe(withoutPatch);
  });
});
