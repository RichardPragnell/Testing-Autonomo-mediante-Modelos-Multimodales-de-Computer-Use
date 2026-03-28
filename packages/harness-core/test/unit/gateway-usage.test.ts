import { describe, expect, it } from "vitest";
import { parseGatewayGenerationLookup } from "../../src/ai/gateway.js";
import { summarizeAiUsage } from "../../src/ai/usage.js";

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
});
