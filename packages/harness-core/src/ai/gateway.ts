import { createGateway } from "@ai-sdk/gateway";
import type { AiCostSource, AiLookupStatus, AiOperation, AiUsagePhase, AiUsageRecord } from "../types.js";
import { nowIso } from "../utils/time.js";

interface GatewayGenerationPayload {
  id?: unknown;
  total_cost?: unknown;
  created_at?: unknown;
  model?: unknown;
  provider_name?: unknown;
  latency?: unknown;
  generation_time?: unknown;
  tokens_prompt?: unknown;
  tokens_completion?: unknown;
  native_tokens_reasoning?: unknown;
  native_tokens_cached?: unknown;
}

interface GatewayGenerationResponse {
  data?: GatewayGenerationPayload;
}

export interface GatewayGenerationLookup {
  generationId: string;
  costUsd: number;
  createdAt?: string;
  modelId?: string;
  provider?: string;
  latencyMs: number;
  generationTimeMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeUsageBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/ai$/, "");
}

export function resolveGatewayAiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_GATEWAY_BASE_URL?.trim() || "https://ai-gateway.vercel.sh/v1/ai";
}

export function resolveGatewayUsageBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeUsageBaseUrl(resolveGatewayAiBaseUrl(env));
}

export function isGatewayCostTrackingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY?.trim());
}

export function createGatewayLanguageModel(modelId: string, env: NodeJS.ProcessEnv = process.env): any {
  const gateway = createGateway({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: resolveGatewayAiBaseUrl(env)
  });

  return gateway(modelId);
}

export function parseGatewayGenerationLookup(response: unknown): GatewayGenerationLookup {
  const data = (response as GatewayGenerationResponse | undefined)?.data;
  if (!data || typeof data !== "object") {
    throw new Error("gateway generation lookup did not include a data payload");
  }

  const generationId = toOptionalString(data.id);
  if (!generationId) {
    throw new Error("gateway generation lookup did not include a generation id");
  }

  const inputTokens = toNumber(data.tokens_prompt);
  const outputTokens = toNumber(data.tokens_completion);
  const reasoningTokens = toNumber(data.native_tokens_reasoning);
  const cachedInputTokens = toNumber(data.native_tokens_cached);

  return {
    generationId,
    costUsd: Number(toNumber(data.total_cost).toFixed(6)),
    createdAt: toOptionalString(data.created_at),
    modelId: toOptionalString(data.model),
    provider: toOptionalString(data.provider_name),
    latencyMs: toNumber(data.latency),
    generationTimeMs: toNumber(data.generation_time),
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens
  };
}

export async function lookupGatewayGeneration(
  generationId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<GatewayGenerationLookup> {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is required for gateway generation lookup");
  }

  const response = await fetchImpl(`${resolveGatewayUsageBaseUrl(env)}/generation?id=${encodeURIComponent(generationId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`gateway generation lookup failed with status ${response.status}`);
  }

  return parseGatewayGenerationLookup(payload);
}

function extractGenerationId(responseMetadata: any, providerMetadata: any): string | undefined {
  if (typeof responseMetadata?.id === "string" && responseMetadata.id.startsWith("gen_")) {
    return responseMetadata.id;
  }

  const gatewayMeta = providerMetadata?.gateway;
  const candidates = [
    gatewayMeta?.generationId,
    gatewayMeta?.id,
    providerMetadata?.generationId,
    providerMetadata?.id,
    responseMetadata?.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function usageFromSdkResult(result: any) {
  const usage = result?.usage ?? {};
  return {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0),
    reasoningTokens: Number(usage.reasoningTokens ?? 0),
    cachedInputTokens: Number(usage.cachedInputTokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0)
  };
}

export async function buildGatewayUsageRecord(input: {
  result: any;
  requestedModelId: string;
  requestedProvider: string;
  phase: AiUsagePhase;
  operation: AiOperation;
  startedAt: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AiUsageRecord> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const usage = usageFromSdkResult(input.result);
  const responseMetadata = await Promise.resolve(input.result?.response);
  const providerMetadata = input.result?.providerMetadata;
  const generationId = extractGenerationId(responseMetadata, providerMetadata);
  const latencyMs = Date.now() - input.startedAt;

  if (!generationId) {
    return {
      phase: input.phase,
      operation: input.operation,
      requestedModelId: input.requestedModelId,
      requestedProvider: input.requestedProvider,
      lookupStatus: "missing_generation_id",
      costSource: "unavailable",
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
      timestamp: nowIso(),
      error: "gateway generation id was not present in the AI SDK response"
    };
  }

  try {
    const generation = await lookupGatewayGeneration(generationId, env, fetchImpl);
    return {
      phase: input.phase,
      operation: input.operation,
      requestedModelId: input.requestedModelId,
      requestedProvider: input.requestedProvider,
      servedModelId: generation.modelId,
      servedProvider: generation.provider,
      generationId,
      lookupStatus: "resolved",
      costSource: "exact",
      costUsd: generation.costUsd,
      latencyMs: generation.generationTimeMs || generation.latencyMs || latencyMs,
      inputTokens: generation.inputTokens || usage.inputTokens,
      outputTokens: generation.outputTokens || usage.outputTokens,
      reasoningTokens: generation.reasoningTokens || usage.reasoningTokens,
      cachedInputTokens: generation.cachedInputTokens || usage.cachedInputTokens,
      totalTokens: generation.totalTokens || usage.totalTokens,
      timestamp: generation.createdAt ?? nowIso()
    };
  } catch (error) {
    return {
      phase: input.phase,
      operation: input.operation,
      requestedModelId: input.requestedModelId,
      requestedProvider: input.requestedProvider,
      generationId,
      lookupStatus: "lookup_failed",
      costSource: "unavailable",
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
      timestamp: nowIso(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
