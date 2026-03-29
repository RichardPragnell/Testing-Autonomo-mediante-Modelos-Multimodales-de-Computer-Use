import { describe, expect, it } from "vitest";
import { parseGatewayGenerationLookup } from "../../src/ai/gateway.js";
import { formatUsageCost, summarizeAiUsage, summarizeUsageCosts } from "../../src/ai/usage.js";

describe("gateway generation lookup parsing", () => {
  it("normalizes exact billing and token fields from the gateway payload", () => {
    const lookup = parseGatewayGenerationLookup({
      data: {
        id: "gen_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        total_cost: 0.00123,
        created_at: "2026-03-28T10:00:00.000Z",
        model: "openai/gpt-4o-mini",
        provider_name: "openai",
        latency: 220,
        generation_time: 1450,
        tokens_prompt: 100,
        tokens_completion: 50,
        native_tokens_reasoning: 12,
        native_tokens_cached: 30
      }
    });

    expect(lookup.generationId).toBe("gen_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(lookup.costUsd).toBe(0.00123);
    expect(lookup.provider).toBe("openai");
    expect(lookup.modelId).toBe("openai/gpt-4o-mini");
    expect(lookup.inputTokens).toBe(100);
    expect(lookup.outputTokens).toBe(50);
    expect(lookup.reasoningTokens).toBe(12);
    expect(lookup.cachedInputTokens).toBe(30);
    expect(lookup.totalTokens).toBe(162);
  });
});

describe("usage aggregation", () => {
  it("marks the aggregate as unavailable when any exact lookup is missing", () => {
    const summary = summarizeAiUsage([
      {
        phase: "repair",
        operation: "agent",
        requestedModelId: "openai/gpt-4o-mini",
        requestedProvider: "openai",
        lookupStatus: "resolved",
        costSource: "exact",
        costUsd: 0.004,
        latencyMs: 600,
        inputTokens: 800,
        outputTokens: 200,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 1000,
        timestamp: "2026-03-28T10:00:00.000Z"
      },
      {
        phase: "repair",
        operation: "agent",
        requestedModelId: "openai/gpt-4o-mini",
        requestedProvider: "openai",
        lookupStatus: "lookup_failed",
        costSource: "unavailable",
        latencyMs: 450,
        inputTokens: 300,
        outputTokens: 80,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 380,
        timestamp: "2026-03-28T10:00:01.000Z",
        error: "lookup failed"
      }
    ]);

    expect(summary.costSource).toBe("unavailable");
    expect(summary.costUsd).toBeUndefined();
    expect(summary.resolvedCostUsd).toBe(0.004);
    expect(summary.unavailableCalls).toBe(1);
  });

  it("builds a resolved cost summary without pretending unavailable usage is zero-cost", () => {
    const costSummary = summarizeUsageCosts(
      [
        {
          latencyMs: 600,
          inputTokens: 800,
          outputTokens: 200,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 1000,
          costUsd: undefined,
          resolvedCostUsd: 0.004,
          costSource: "unavailable",
          callCount: 2,
          unavailableCalls: 1
        },
        {
          latencyMs: 120,
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 120,
          costUsd: 0.002,
          resolvedCostUsd: 0.002,
          costSource: "exact",
          callCount: 1,
          unavailableCalls: 0
        }
      ],
      2
    );

    expect(costSummary.avgResolvedUsd).toBe(0.003);
    expect(costSummary.totalResolvedUsd).toBe(0.006);
    expect(costSummary.costSource).toBe("unavailable");
    expect(costSummary.unavailableCalls).toBe(1);
  });

  it("formats unavailable usage as partial when resolved spend exists", () => {
    expect(
      formatUsageCost({
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
        costUsd: undefined,
        resolvedCostUsd: 0.004,
        costSource: "unavailable",
        callCount: 1,
        unavailableCalls: 1
      })
    ).toBe("$0.0040 (partial)");
  });
});
