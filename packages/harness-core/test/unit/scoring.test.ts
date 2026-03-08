import { describe, expect, it } from "vitest";
import { buildModelMetrics, computeCompositeScore } from "../../src/benchmark/score.js";

describe("scoring", () => {
  it("computes bounded composite score", () => {
    const score = computeCompositeScore({
      passRate: 0.8,
      stability: 0.9,
      avgLatencyMs: 1200,
      avgCostUsd: 0.01
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("computes pass-rate and confidence from runs", () => {
    const metrics = buildModelMetrics(
      "google/gemini-2.5-flash",
      [
        {
          taskId: "a",
          trial: 1,
          modelId: "m",
          success: true,
          message: "",
          latencyMs: 1000,
          costUsd: 0.01,
          trace: []
        },
        {
          taskId: "a",
          trial: 2,
          modelId: "m",
          success: false,
          message: "",
          latencyMs: 1200,
          costUsd: 0.02,
          trace: []
        }
      ],
      0
    );

    expect(metrics.passRate).toBe(0.5);
    expect(metrics.confidence95.low).toBeGreaterThanOrEqual(0);
    expect(metrics.confidence95.high).toBeLessThanOrEqual(1);
  });
});

