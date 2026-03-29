import { describe, expect, it } from "vitest";
import { computeExploreScore, computeHealScore, computeQaScore } from "../../src/experiments/scoring.js";

describe("experiment scoring", () => {
  it("penalizes guided runs with zero scenario completion", () => {
    const weak = computeQaScore({
      capabilityPassRate: 0.9,
      fullScenarioCompletionRate: 0,
      taskPassRate: 0.9,
      stability: 0.9,
      avgLatencyMs: 800,
      avgCostUsd: 0.01
    });
    const strong = computeQaScore({
      capabilityPassRate: 0.9,
      fullScenarioCompletionRate: 1,
      taskPassRate: 0.9,
      stability: 0.9,
      avgLatencyMs: 800,
      avgCostUsd: 0.01
    });

    expect(weak).toBeLessThan(strong);
    expect(weak).toBeLessThan(60);
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
      localizationAccuracy: 0.75,
      patchApplyRate: 1,
      validationPassRate: 0,
      failingTaskFixRate: 0,
      regressionFreeRate: 0.8,
      avgLatencyMs: 1500,
      avgCostUsd: 0.02
    });
    const fixed = computeHealScore({
      localizationAccuracy: 0.75,
      patchApplyRate: 1,
      validationPassRate: 1,
      failingTaskFixRate: 1,
      regressionFreeRate: 0.8,
      avgLatencyMs: 1500,
      avgCostUsd: 0.02
    });

    expect(fixed).toBeGreaterThan(patchOnly);
    expect(patchOnly).toBeLessThan(20);
    expect(fixed).toBeLessThanOrEqual(100);
  });
});
