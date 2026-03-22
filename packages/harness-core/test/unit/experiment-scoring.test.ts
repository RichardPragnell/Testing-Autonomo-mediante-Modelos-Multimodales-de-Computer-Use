import { describe, expect, it } from "vitest";
import { computeExploreScore, computeHealScore, computeQaScore } from "../../src/experiments/scoring.js";

describe("experiment scoring", () => {
  it("computes bounded QA score", () => {
    const score = computeQaScore({
      capabilityPassRate: 0.9,
      fullScenarioCompletionRate: 0.75,
      stability: 0.8,
      avgLatencyMs: 1200,
      avgCostUsd: 0.01
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("computes bounded exploration score", () => {
    const score = computeExploreScore({
      capabilityDiscoveryRate: 0.8,
      probeReplayPassRate: 0.7,
      stateCoverage: 1,
      transitionCoverage: 0.75,
      actionDiversity: 0.9,
      avgLatencyMs: 900,
      avgCostUsd: 0.005
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("computes bounded self-heal score", () => {
    const score = computeHealScore({
      localizationAccuracy: 0.75,
      patchApplyRate: 1,
      validationPassRate: 1,
      failingTaskFixRate: 1,
      regressionFreeRate: 0.8,
      avgLatencyMs: 1500,
      avgCostUsd: 0.02
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
