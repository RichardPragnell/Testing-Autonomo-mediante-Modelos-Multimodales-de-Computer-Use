import { generateObject, generateText } from "ai";
import { LLMClient } from "@browserbasehq/stagehand";
import type { AiOperation, AiUsagePhase, AiUsageRecord } from "../types.js";
import { buildOpenRouterUsageRecord, createOpenRouterLanguageModel } from "../ai/openrouter.js";

function normalizeMessageContent(content: any): any {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((item) => {
    if ("image_url" in item) {
      return {
        type: "image",
        image: item.image_url.url
      };
    }

    return {
      type: "text",
      text: item.text
    };
  });
}

function formatMessages(messages: Array<{ role: string; content: any }>) {
  return messages.map((message) => {
    if (Array.isArray(message.content) && message.role === "system") {
      return {
        role: "system" as const,
        content: message.content.map((item: any) => ("text" in item ? item.text : "")).join("\n")
      };
    }

    if (Array.isArray(message.content) && message.role === "assistant") {
      return {
        role: "assistant" as const,
        content: message.content.map((item: any) => ({
          type: "text" as const,
          text: "image" in item || "image_url" in item ? "[Image]" : item.text
        }))
      };
    }

    return {
      role: message.role as "system" | "user" | "assistant",
      content: normalizeMessageContent(message.content)
    };
  });
}

function inferOperation(options: {
  responseModelName?: string;
  hasTools: boolean;
}): AiOperation {
  const normalizedName = options.responseModelName?.toLowerCase();
  if (normalizedName === "act") {
    return "act";
  }
  if (normalizedName === "observation") {
    return "observe";
  }
  if (normalizedName === "extraction") {
    return "extract";
  }
  if (normalizedName === "metadata") {
    return "metadata";
  }
  if (options.hasTools) {
    return "agent";
  }
  return "unknown";
}

interface StagehandOpenRouterTrackingClientOptions {
  modelId: string;
  provider: string;
  phase: AiUsagePhase;
  usageSink: AiUsageRecord[];
  env?: NodeJS.ProcessEnv;
}

export class StagehandOpenRouterTrackingClient extends LLMClient {
  override type: string;
  override hasVision = true;
  private readonly model: any;
  private readonly phase: AiUsagePhase;
  private readonly requestedProvider: string;
  private readonly usageSink: AiUsageRecord[];

  constructor(options: StagehandOpenRouterTrackingClientOptions) {
    super(options.modelId);
    this.type = options.provider;
    this.phase = options.phase;
    this.requestedProvider = options.provider;
    this.usageSink = options.usageSink;
    this.model = createOpenRouterLanguageModel(options.modelId, options.env ?? process.env);
  }

  override getLanguageModel() {
    return this.model;
  }

  private async recordUsage(result: any, operation: AiOperation, startedAt: number): Promise<void> {
    this.usageSink.push(
      await buildOpenRouterUsageRecord({
        result,
        requestedModelId: this.modelName,
        requestedProvider: this.requestedProvider,
        phase: this.phase,
        operation,
        startedAt
      })
    );
  }

  override generateText = async (options: any): Promise<any> => {
    const startedAt = Date.now();
    const result = await generateText(options);
    await this.recordUsage(result, "agent", startedAt);
    return result;
  };

  async createChatCompletion<T = any>({ options }: { options: any }): Promise<T> {
    const messages = formatMessages(options.messages);
    const operation = inferOperation({
      responseModelName: options.response_model?.name,
      hasTools: Array.isArray(options.tools) && options.tools.length > 0
    });
    const startedAt = Date.now();

    if (options.response_model) {
      const response = await generateObject({
        model: this.model,
        messages,
        schema: options.response_model.schema
      });
      await this.recordUsage(response, operation, startedAt);
      return {
        data: response.object,
        usage: {
          prompt_tokens: response.usage.inputTokens ?? 0,
          completion_tokens: response.usage.outputTokens ?? 0,
          reasoning_tokens: response.usage.reasoningTokens ?? 0,
          cached_input_tokens: response.usage.cachedInputTokens ?? 0,
          total_tokens: response.usage.totalTokens ?? 0
        }
      } as T;
    }

    const tools: Record<string, any> = {};
    for (const rawTool of options.tools ?? []) {
      tools[rawTool.name] = {
        description: rawTool.description,
        inputSchema: rawTool.parameters
      };
    }

    const response = await generateText({
      model: this.model,
      messages,
      tools
    });
    await this.recordUsage(response, operation, startedAt);
    return {
      data: response.text,
      usage: {
        prompt_tokens: response.usage.inputTokens ?? 0,
        completion_tokens: response.usage.outputTokens ?? 0,
        reasoning_tokens: response.usage.reasoningTokens ?? 0,
        cached_input_tokens: response.usage.cachedInputTokens ?? 0,
        total_tokens: response.usage.totalTokens ?? 0
      }
    } as T;
  }
}
