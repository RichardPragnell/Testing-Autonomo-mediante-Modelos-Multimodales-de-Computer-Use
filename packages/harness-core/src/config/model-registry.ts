import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { ModelAvailability, ModelRegistry } from "../types.js";

const modelConfigSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  enabled: z.boolean().default(true)
});

const modelRegistrySchema = z.object({
  models: z.array(modelConfigSchema).min(1)
});

function normalizeRegistry(input: z.infer<typeof modelRegistrySchema>): ModelRegistry {
  const models = input.models.map((model) => ({
    id: model.id,
    provider: model.provider,
    enabled: model.enabled
  }));
  return { models };
}

export async function loadModelRegistry(modelsPath: string): Promise<ModelRegistry> {
  const raw = await readFile(modelsPath, "utf8");
  const extension = extname(modelsPath).toLowerCase();
  const parsed = extension === ".json" ? JSON.parse(raw) : YAML.parse(raw);
  const registry = modelRegistrySchema.parse(parsed);
  return normalizeRegistry(registry);
}

export function resolveModelAvailability(
  registry: ModelRegistry,
  requestedModels: string[] | undefined,
  env: NodeJS.ProcessEnv = process.env
): ModelAvailability[] {
  const openRouterEnabled = Boolean(env.OPENROUTER_API_KEY?.trim());
  const requestedSet = requestedModels?.length ? new Set(requestedModels) : undefined;
  const selected = requestedSet
    ? registry.models.filter((model) => requestedSet.has(model.id))
    : registry.models.filter((model) => model.enabled);

  return selected.map((model) => {
    if (!model.enabled) {
      return { ...model, available: false, reason: "model disabled in registry" };
    }
    if (!openRouterEnabled) {
      return {
        ...model,
        available: false,
        reason: "missing required env key OPENROUTER_API_KEY"
      };
    }
    return { ...model, available: true };
  });
}
