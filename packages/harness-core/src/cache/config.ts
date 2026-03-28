import { join } from "node:path";
import type { ExecutionCacheConfig } from "../types.js";
import { sha256 } from "../utils/hash.js";
import { ensureDir, resolveWorkspacePath } from "../utils/fs.js";

function normalizeBugIds(bugIds: string[]): string[] {
  return [...bugIds].sort();
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "cache";
}

export function buildStagehandConfigSignature(input: {
  executionKind: "guided" | "explore";
  stagehandEnv?: string;
  systemPrompt?: string;
  instructionPrompt?: string;
  selfHeal?: boolean;
}): string {
  return sha256(
    JSON.stringify({
      executionKind: input.executionKind,
      stagehandEnv: input.stagehandEnv ?? "LOCAL",
      selfHeal: input.selfHeal ?? true,
      systemPrompt: input.systemPrompt ?? "",
      instructionPrompt: input.instructionPrompt ?? ""
    })
  );
}

export async function resolveExecutionCacheConfig(input: {
  resultsDir: string;
  targetId: string;
  bugIds: string[];
  viewport: {
    width: number;
    height: number;
  };
  modelId: string;
  configSignature: string;
}): Promise<ExecutionCacheConfig> {
  const resultsRoot = await resolveWorkspacePath(input.resultsDir);
  const rootDir = join(resultsRoot, "stagehand-cache");
  const namespaceHash = sha256(
    JSON.stringify({
      targetId: input.targetId,
      bugIds: normalizeBugIds(input.bugIds),
      viewport: input.viewport,
      modelId: input.modelId,
      configSignature: input.configSignature
    })
  ).slice(0, 16);
  const namespace = `${sanitizeSegment(input.targetId)}-${namespaceHash}`;
  const cacheDir = join(rootDir, namespace);

  await ensureDir(cacheDir);

  return {
    rootDir,
    namespace,
    cacheDir,
    configSignature: input.configSignature
  };
}
