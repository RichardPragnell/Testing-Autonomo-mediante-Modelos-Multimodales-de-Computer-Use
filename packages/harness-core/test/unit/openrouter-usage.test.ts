import { describe, expect, it } from "vitest";
import {
  buildOpenRouterUsageRecord,
  buildPinnedOpenRouterProviderOptions,
  parseOpenRouterUsage
} from "../../src/ai/openrouter.js";
import { formatUsageCost, summarizeAiUsage, summarizeUsageCosts } from "../../src/ai/usage.js";

describe("openrouter usage parsing", () => {
  it("builds provider options that pin routing to one provider", () => {
    expect(buildPinnedOpenRouterProviderOptions("openai")).toEqual({
      "openrouter.chat": {
        provider: {
          only: ["openai"],
          allow_fallbacks: false
        }
      }
    });
  });

  it("normalizes exact billing and token fields from the response usage payload", () => {
    const usage = parseOpenRouterUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 162,
      cost: "0.00123",
      completion_tokens_details: {
        reasoning_tokens: 12
      },
      prompt_tokens_details: {
        cached_tokens: 30
      }
    });

    expect(usage.costUsd).toBe(0.00123);
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.reasoningTokens).toBe(12);
    expect(usage.cachedInputTokens).toBe(30);
    expect(usage.totalTokens).toBe(162);
  });

  it("builds an exact usage record directly from provider metadata", async () => {
    const record = await buildOpenRouterUsageRecord({
      result: {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 12,
          cachedInputTokens: 30,
          totalTokens: 162
        },
        response: {
          id: "gen-openrouter-123",
          model: "openai/gpt-4o-mini"
        },
        providerMetadata: {
          openrouter: {
            id: "gen-openrouter-123",
            model: "openai/gpt-4o-mini",
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 162,
              cost: 0.00123,
              completion_tokens_details: {
                reasoning_tokens: 12
              },
              prompt_tokens_details: {
                cached_tokens: 30
              }
            }
          }
        }
      },
      requestedModelId: "openai/gpt-4o-mini",
      requestedProvider: "openai",
      phase: "repair",
      operation: "agent",
      startedAt: Date.now() - 10
    });

    expect(record.costSource).toBe("exact");
    expect(record.costUsd).toBe(0.00123);
    expect(record.generationId).toBe("gen-openrouter-123");
    expect(record.servedModelId).toBe("openai/gpt-4o-mini");
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(50);
    expect(record.reasoningTokens).toBe(12);
    expect(record.cachedInputTokens).toBe(30);
    expect(record.totalTokens).toBe(162);
  });

  it("marks usage unavailable when the provider response omits exact cost", async () => {
    const record = await buildOpenRouterUsageRecord({
      result: {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 12,
          cachedInputTokens: 30,
          totalTokens: 162
        },
        response: {
          id: "gen-openrouter-456",
          model: "openai/gpt-4o-mini"
        },
        providerMetadata: {
          openrouter: {
            id: "gen-openrouter-456",
            model: "openai/gpt-4o-mini",
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 162,
              completion_tokens_details: {
                reasoning_tokens: 12
              },
              prompt_tokens_details: {
                cached_tokens: 30
              }
            }
          }
        }
      },
      requestedModelId: "openai/gpt-4o-mini",
      requestedProvider: "openai",
      phase: "repair",
      operation: "agent",
      startedAt: Date.now() - 10
    });

    expect(record.costSource).toBe("unavailable");
    expect(record.costUsd).toBeUndefined();
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(50);
  });
});

describe("usage aggregation", () => {
  it("marks the aggregate as unavailable when any exact cost is missing", () => {
    const summary = summarizeAiUsage([
      {
        phase: "repair",
        operation: "agent",
        requestedModelId: "openai/gpt-4o-mini",
        requestedProvider: "openai",
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
        costSource: "unavailable",
        latencyMs: 450,
        inputTokens: 300,
        outputTokens: 80,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 380,
        timestamp: "2026-03-28T10:00:01.000Z",
        error: "provider response did not include exact usage cost"
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

  it("formats zero-call usage distinctly from exact zero cost", () => {
    expect(
      formatUsageCost({
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        resolvedCostUsd: 0,
        costSource: "exact",
        callCount: 0,
        unavailableCalls: 0
      })
    ).toBe("No AI calls");
  });
});
