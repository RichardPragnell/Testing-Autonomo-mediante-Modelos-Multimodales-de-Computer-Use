import {
  OpenAICompatibleChatLanguageModel,
  type MetadataExtractor
} from "@ai-sdk/openai-compatible";
import type { AiOperation, AiUsagePhase, AiUsageRecord } from "../types.js";
import { nowIso } from "../utils/time.js";

interface OpenRouterUsageDetails {
  costUsd?: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

interface OpenRouterProviderMetadata {
  id?: string;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsageDetails;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toNumber(value: unknown): number {
  return toOptionalNumber(value) ?? 0;
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function resolveOpenRouterBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
}

export function isOpenRouterCostTrackingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}

export function parseOpenRouterUsage(usage: unknown): OpenRouterUsageDetails {
  const usageRecord = asRecord(usage) ?? {};
  const promptTokenDetails = asRecord(usageRecord.prompt_tokens_details);
  const completionTokenDetails = asRecord(usageRecord.completion_tokens_details);
  const inputTokens = toNumber(usageRecord.inputTokens ?? usageRecord.prompt_tokens);
  const outputTokens = toNumber(usageRecord.outputTokens ?? usageRecord.completion_tokens);
  const reasoningTokens = toNumber(
    usageRecord.reasoningTokens ?? completionTokenDetails?.reasoning_tokens
  );
  const cachedInputTokens = toNumber(
    usageRecord.cachedInputTokens ?? promptTokenDetails?.cached_tokens
  );
  const totalTokens =
    toOptionalNumber(usageRecord.totalTokens ?? usageRecord.total_tokens) ??
    inputTokens + outputTokens + reasoningTokens;
  const costUsd = toOptionalNumber(usageRecord.costUsd ?? usageRecord.cost);

  return {
    costUsd: typeof costUsd === "number" ? roundCost(costUsd) : undefined,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens
  };
}

function buildProviderMetadata(parsedBody: unknown): OpenRouterProviderMetadata | undefined {
  const body = asRecord(parsedBody);
  if (!body) {
    return undefined;
  }

  const metadata: OpenRouterProviderMetadata = {
    id: toOptionalString(body.id),
    model: toOptionalString(body.model),
    provider: toOptionalString(body.provider ?? body.provider_name),
    usage: body.usage ? parseOpenRouterUsage(body.usage) : undefined
  };

  if (!metadata.id && !metadata.model && !metadata.provider && !metadata.usage) {
    return undefined;
  }

  return metadata;
}

function toSharedProviderMetadata(
  metadata: OpenRouterProviderMetadata | undefined
): Awaited<ReturnType<MetadataExtractor["extractMetadata"]>> {
  return metadata
    ? ({
        openrouter: metadata as unknown as Record<string, unknown>
      } as Awaited<ReturnType<MetadataExtractor["extractMetadata"]>>)
    : undefined;
}

function createOpenRouterMetadataExtractor(): MetadataExtractor {
  return {
    extractMetadata: async ({ parsedBody }: { parsedBody: unknown }) => {
      return toSharedProviderMetadata(buildProviderMetadata(parsedBody));
    },
    createStreamExtractor: () => {
      let latestBody: unknown;
      return {
        processChunk: (parsedChunk: unknown) => {
          if (parsedChunk) {
            latestBody = parsedChunk;
          }
        },
        buildMetadata: () => {
          return toSharedProviderMetadata(buildProviderMetadata(latestBody));
        }
      };
    }
  };
}

export function createOpenRouterLanguageModel(modelId: string, env: NodeJS.ProcessEnv = process.env): any {
  const baseURL = resolveOpenRouterBaseUrl(env).replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (env.OPENROUTER_API_KEY?.trim()) {
    headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;
  }

  return new OpenAICompatibleChatLanguageModel(modelId, {
    provider: "openrouter.chat",
    url: ({ path }) => `${baseURL}${path}`,
    headers: () => headers,
    includeUsage: true,
    supportsStructuredOutputs: true,
    metadataExtractor: createOpenRouterMetadataExtractor()
  });
}

function usageFromSdkResult(result: any): OpenRouterUsageDetails {
  const usage = result?.usage ?? {};
  return {
    costUsd: undefined,
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0),
    reasoningTokens: Number(usage.reasoningTokens ?? 0),
    cachedInputTokens: Number(usage.cachedInputTokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0)
  };
}

function extractOpenRouterMetadata(responseMetadata: any, providerMetadata: any): OpenRouterProviderMetadata {
  const openRouterMeta = asRecord(providerMetadata?.openrouter);
  const usage = openRouterMeta?.usage
    ? parseOpenRouterUsage(openRouterMeta.usage)
    : responseMetadata?.usage
      ? parseOpenRouterUsage(responseMetadata.usage)
      : undefined;

  return {
    id:
      toOptionalString(openRouterMeta?.id) ??
      toOptionalString(providerMetadata?.id) ??
      toOptionalString(responseMetadata?.id),
    model:
      toOptionalString(openRouterMeta?.model) ??
      toOptionalString(responseMetadata?.model),
    provider:
      toOptionalString(openRouterMeta?.provider) ??
      toOptionalString(responseMetadata?.provider ?? responseMetadata?.provider_name),
    usage
  };
}

export async function buildOpenRouterUsageRecord(input: {
  result: any;
  requestedModelId: string;
  requestedProvider: string;
  phase: AiUsagePhase;
  operation: AiOperation;
  startedAt: number;
}): Promise<AiUsageRecord> {
  const sdkUsage = usageFromSdkResult(input.result);
  const responseMetadata = await Promise.resolve(input.result?.response);
  const providerMetadata = input.result?.providerMetadata;
  const metadata = extractOpenRouterMetadata(responseMetadata, providerMetadata);
  const usage = metadata.usage ?? sdkUsage;
  const latencyMs = Date.now() - input.startedAt;

  if (typeof metadata.usage?.costUsd === "number") {
    return {
      phase: input.phase,
      operation: input.operation,
      requestedModelId: input.requestedModelId,
      requestedProvider: input.requestedProvider,
      servedModelId: metadata.model ?? input.requestedModelId,
      servedProvider: metadata.provider ?? input.requestedProvider,
      generationId: metadata.id,
      costSource: "exact",
      costUsd: metadata.usage.costUsd,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
      timestamp: nowIso()
    };
  }

  return {
    phase: input.phase,
    operation: input.operation,
    requestedModelId: input.requestedModelId,
    requestedProvider: input.requestedProvider,
    servedModelId: metadata.model,
    servedProvider: metadata.provider,
    generationId: metadata.id,
    costSource: "unavailable",
    latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
    totalTokens: usage.totalTokens,
    timestamp: nowIso(),
    error: "provider response did not include exact usage cost"
  };
}
