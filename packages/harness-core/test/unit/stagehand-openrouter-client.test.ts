import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.fn();
const generateTextMock = vi.fn();
const buildOpenRouterUsageRecordMock = vi.fn();
const createOpenRouterLanguageModelMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: generateObjectMock,
  generateText: generateTextMock
}));

vi.mock("../../src/ai/openrouter.js", () => ({
  buildOpenRouterUsageRecord: buildOpenRouterUsageRecordMock,
  buildPinnedOpenRouterProviderOptions: (provider: string) => ({
    "openrouter.chat": {
      provider: {
        only: [provider],
        allow_fallbacks: false
      }
    }
  }),
  createOpenRouterLanguageModel: createOpenRouterLanguageModelMock
}));

const { StagehandOpenRouterTrackingClient } = await import("../../src/runner/stagehand-openrouter-client.js");

describe("stagehand openrouter client", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    generateTextMock.mockReset();
    buildOpenRouterUsageRecordMock.mockReset();
    createOpenRouterLanguageModelMock.mockReset();

    createOpenRouterLanguageModelMock.mockReturnValue({ provider: "mock-model" });
    buildOpenRouterUsageRecordMock.mockResolvedValue({
      phase: "guided_scenario",
      operation: "act",
      requestedModelId: "z-ai/glm-4-32b",
      requestedProvider: "z-ai",
      costSource: "exact",
      costUsd: 0.001,
      latencyMs: 10,
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 15,
      timestamp: "2026-03-30T00:00:00.000Z"
    });
  });

  it("forwards structured generation options including maxOutputTokens", async () => {
    generateObjectMock.mockResolvedValue({
      object: { elementId: "1-1" },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 120
      }
    });

    const usageSink: unknown[] = [];
    const client = new StagehandOpenRouterTrackingClient({
      modelId: "z-ai/glm-4-32b",
      provider: "z-ai",
      phase: "guided_scenario",
      usageSink: usageSink as never[],
      defaultMaxOutputTokens: 300
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "click edit" }],
        response_model: {
          name: "act",
          schema: { type: "object" }
        },
        temperature: 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: 123
      }
    });

    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 123,
        providerOptions: {
          "openrouter.chat": {
            provider: {
              only: ["z-ai"],
              allow_fallbacks: false
            }
          }
        },
        temperature: 0.1,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0
      })
    );
    expect(usageSink).toHaveLength(1);
  });

  it("applies the default maxOutputTokens cap for text generations and forwards tools", async () => {
    generateTextMock.mockResolvedValue({
      text: "done",
      usage: {
        inputTokens: 60,
        outputTokens: 15,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 75
      }
    });

    const usageSink: unknown[] = [];
    const client = new StagehandOpenRouterTrackingClient({
      modelId: "z-ai/glm-4-32b",
      provider: "z-ai",
      phase: "guided_scenario",
      usageSink: usageSink as never[],
      defaultMaxOutputTokens: 300
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "perform one action" }],
        tools: [
          {
            name: "click",
            description: "click an element",
            parameters: { type: "object" }
          }
        ],
        temperature: 0.2,
        top_p: 0.9
      }
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 300,
        providerOptions: {
          "openrouter.chat": {
            provider: {
              only: ["z-ai"],
              allow_fallbacks: false
            }
          }
        },
        temperature: 0.2,
        topP: 0.9,
        tools: {
          click: {
            description: "click an element",
            inputSchema: { type: "object" }
          }
        }
      })
    );
    expect(usageSink).toHaveLength(1);
  });

  it("pins the configured provider for direct text generations", async () => {
    generateTextMock.mockResolvedValue({
      text: "done",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 15
      }
    });

    const client = new StagehandOpenRouterTrackingClient({
      modelId: "z-ai/glm-4-32b",
      provider: "z-ai",
      phase: "guided_scenario",
      usageSink: [] as never[],
      defaultMaxOutputTokens: 300
    });

    await client.generateText({ prompt: "perform one action" });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          "openrouter.chat": {
            provider: {
              only: ["z-ai"],
              allow_fallbacks: false
            }
          }
        }
      })
    );
  });

  it.each([
    { responseModelName: "observation", expectedOperation: "observe" },
    { responseModelName: "extraction", expectedOperation: "extract" }
  ])(
    "records %s usage operations for structured generations",
    async ({ responseModelName, expectedOperation }) => {
      generateObjectMock.mockResolvedValue({
        object: { ok: true },
        usage: {
          inputTokens: 40,
          outputTokens: 10,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 50
        }
      });

      const client = new StagehandOpenRouterTrackingClient({
        modelId: "z-ai/glm-4-32b",
        provider: "z-ai",
        phase: "guided_scenario",
        usageSink: [] as never[],
        defaultMaxOutputTokens: 300
      });

      await client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "inspect the page" }],
          response_model: {
            name: responseModelName,
            schema: { type: "object" }
          }
        }
      });

      expect(buildOpenRouterUsageRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expectedOperation,
          phase: "guided_scenario",
          requestedModelId: "z-ai/glm-4-32b",
          requestedProvider: "z-ai"
        })
      );
    }
  );
});
