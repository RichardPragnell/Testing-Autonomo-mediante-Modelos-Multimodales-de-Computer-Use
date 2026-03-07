import { describe, expect, it } from "vitest";
import { buildExperimentReport } from "../../src/reporting/report.js";
import type { Finding, ModelRunSummary } from "../../src/types.js";

describe("report snapshot", () => {
  it("builds a stable report shape", () => {
    const modelSummaries: ModelRunSummary[] = [
      {
        model: {
          id: "google/gemini-2.5-flash",
          provider: "google",
          envKey: "GEMINI_API_KEY",
          enabled: true,
          available: true
        },
        metrics: {
          modelId: "google/gemini-2.5-flash",
          total: 10,
          passed: 8,
          failed: 2,
          skipped: 0,
          passRate: 0.8,
          stability: 0.9,
          avgLatencyMs: 1200,
          avgCostUsd: 0.01,
          score: 82.5,
          confidence95: { low: 0.55, high: 0.93 }
        },
        taskRuns: []
      },
      {
        model: {
          id: "openai/gpt-4o-mini",
          provider: "openai",
          envKey: "OPENAI_API_KEY",
          enabled: true,
          available: true
        },
        metrics: {
          modelId: "openai/gpt-4o-mini",
          total: 10,
          passed: 7,
          failed: 3,
          skipped: 0,
          passRate: 0.7,
          stability: 0.85,
          avgLatencyMs: 1500,
          avgCostUsd: 0.02,
          score: 75.2,
          confidence95: { low: 0.46, high: 0.88 }
        },
        taskRuns: []
      }
    ];

    const findings: Finding[] = [
      {
        id: "f-1",
        runId: "run-1",
        modelId: "openai/gpt-4o-mini",
        taskId: "task-a",
        trial: 1,
        severity: "medium",
        category: "locator",
        message: "element not found",
        artifacts: {},
        createdAt: "2026-03-07T00:00:00.000Z"
      }
    ];

    const report = buildExperimentReport({
      runId: "run-1",
      experimentId: "exp-1",
      modelSummaries,
      findings,
      repairs: []
    });

    expect(report).toMatchInlineSnapshot(
      {
        generatedAt: expect.any(String)
      },
      `
      {
        "confidence": {
          "google/gemini-2.5-flash": {
            "high": 0.93,
            "low": 0.55,
          },
          "openai/gpt-4o-mini": {
            "high": 0.88,
            "low": 0.46,
          },
        },
        "experimentId": "exp-1",
        "failureClusters": {
          "assertion": 0,
          "locator": 1,
          "navigation": 0,
          "state": 0,
          "timeout": 0,
          "unexpected_ui": 0,
          "unknown": 0,
        },
        "generatedAt": Any<String>,
        "leaderboard": [
          {
            "avgCostUsd": 0.01,
            "avgLatencyMs": 1200,
            "modelId": "google/gemini-2.5-flash",
            "passRate": 0.8,
            "provider": "google",
            "rank": 1,
            "score": 82.5,
            "stability": 0.9,
          },
          {
            "avgCostUsd": 0.02,
            "avgLatencyMs": 1500,
            "modelId": "openai/gpt-4o-mini",
            "passRate": 0.7,
            "provider": "openai",
            "rank": 2,
            "score": 75.2,
            "stability": 0.85,
          },
        ],
        "repairOutcomes": {
          "fixed": 0,
          "not_fixed": 0,
          "regression": 0,
          "skipped": 0,
        },
        "runId": "run-1",
      }
      `
    );
  });
});

