import { sha256, stableTextHash } from "../utils/hash.js";
import type {
  ActionCacheEntry,
  ExplorationArtifact,
  ExplorationCacheUsage,
  ObservedAction
} from "../types.js";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3);
}

export function normalizeObservedAction(action: ObservedAction): ObservedAction {
  return {
    selector: normalizeWhitespace(action.selector),
    description: normalizeWhitespace(action.description),
    method: action.method ? normalizeWhitespace(action.method).toLowerCase() : undefined,
    arguments: (action.arguments ?? []).map((value) => normalizeWhitespace(String(value)))
  };
}

export function actionSignature(action: ObservedAction): string {
  const normalized = normalizeObservedAction(action);
  return stableTextHash(
    [
      normalized.method ?? "click",
      normalized.selector,
      normalized.description.toLowerCase(),
      ...(normalized.arguments ?? [])
    ].join("|")
  );
}

export function buildActionCacheEntries(input: {
  stateId: string;
  url: string;
  domHash: string;
  visualHash: string;
  actions: ObservedAction[];
  instructionHint?: string;
}): ActionCacheEntry[] {
  return input.actions.map((action) => {
    const normalized = normalizeObservedAction(action);
    const signature = actionSignature(normalized);
    return {
      actionId: sha256(`${input.stateId}|${signature}`),
      stateId: input.stateId,
      url: input.url,
      domHash: input.domHash,
      visualHash: input.visualHash,
      selector: normalized.selector,
      description: normalized.description,
      method: normalized.method,
      arguments: normalized.arguments ?? [],
      signature,
      instructionHints: input.instructionHint ? [normalizeWhitespace(input.instructionHint)] : [],
      observationCount: 1,
      executionCount: 0
    };
  });
}

export function mergeActionCache(existing: ActionCacheEntry[], incoming: ActionCacheEntry[]): ActionCacheEntry[] {
  const merged = new Map(existing.map((entry) => [entry.actionId, { ...entry }]));

  for (const entry of incoming) {
    const current = merged.get(entry.actionId);
    if (!current) {
      merged.set(entry.actionId, { ...entry });
      continue;
    }

    current.observationCount += entry.observationCount;
    current.executionCount += entry.executionCount;
    current.instructionHints = [...new Set([...current.instructionHints, ...entry.instructionHints])];
  }

  return [...merged.values()];
}

function scoreEntry(entry: ActionCacheEntry, instruction: string, stateId?: string): number {
  const instructionTokens = new Set(tokenize(instruction));
  const descriptionTokens = new Set(tokenize([entry.description, entry.method ?? "", ...entry.arguments].join(" ")));
  const hintTokens = new Set(tokenize(entry.instructionHints.join(" ")));

  let descriptionOverlap = 0;
  let hintOverlap = 0;
  for (const token of instructionTokens) {
    if (descriptionTokens.has(token)) {
      descriptionOverlap += 1;
    }
    if (hintTokens.has(token)) {
      hintOverlap += 1;
    }
  }

  const exactStateBonus = stateId && entry.stateId === stateId ? 50 : 0;
  const unusedBonus = Math.max(0, 10 - entry.executionCount);
  return exactStateBonus + descriptionOverlap * 12 + hintOverlap * 4 + unusedBonus;
}

export function matchActionCache(input: {
  cache: ActionCacheEntry[];
  instruction: string;
  stateId?: string;
  limit?: number;
}): ActionCacheEntry[] {
  const ranked = input.cache
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, input.instruction, input.stateId)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.actionId.localeCompare(right.entry.actionId));

  return ranked.slice(0, input.limit ?? 3).map((item) => item.entry);
}

export function markExecutedActions(
  cache: ActionCacheEntry[],
  actionIds: string[],
  instruction?: string
): ActionCacheEntry[] {
  const executed = new Set(actionIds);
  return cache.map((entry) => {
    if (!executed.has(entry.actionId)) {
      return entry;
    }

    return {
      ...entry,
      executionCount: entry.executionCount + 1,
      instructionHints: instruction
        ? [...new Set([...entry.instructionHints, normalizeWhitespace(instruction)])]
        : entry.instructionHints
    };
  });
}

function normalizeBugIds(bugIds: string[]): string[] {
  return [...bugIds].sort();
}

export function resolveExplorationCompatibility(input: {
  artifact: ExplorationArtifact;
  targetId: string;
  bugIds: string[];
  modelId: string;
  viewport: {
    width: number;
    height: number;
  };
}): ExplorationCacheUsage {
  const normalizedRequestedBugs = normalizeBugIds(input.bugIds);
  const normalizedArtifactBugs = normalizeBugIds(input.artifact.bugIds);

  if (input.artifact.targetId !== input.targetId) {
    return {
      explorationRunId: input.artifact.explorationRunId,
      compatible: false,
      reason: `target mismatch: ${input.artifact.targetId} != ${input.targetId}`,
      matchedActions: 0
    };
  }

  if (normalizedArtifactBugs.join("|") !== normalizedRequestedBugs.join("|")) {
    return {
      explorationRunId: input.artifact.explorationRunId,
      compatible: false,
      reason: `bug mismatch: ${normalizedArtifactBugs.join(", ") || "(none)"} != ${normalizedRequestedBugs.join(", ") || "(none)"}`,
      matchedActions: 0
    };
  }

  if (input.artifact.modelId !== input.modelId) {
    return {
      explorationRunId: input.artifact.explorationRunId,
      compatible: false,
      reason: `model mismatch: ${input.artifact.modelId} != ${input.modelId}`,
      matchedActions: 0
    };
  }

  if (
    input.artifact.compatibility.viewport.width !== input.viewport.width ||
    input.artifact.compatibility.viewport.height !== input.viewport.height
  ) {
    return {
      explorationRunId: input.artifact.explorationRunId,
      compatible: false,
      reason: `viewport mismatch: ${input.artifact.compatibility.viewport.width}x${input.artifact.compatibility.viewport.height} != ${input.viewport.width}x${input.viewport.height}`,
      matchedActions: 0
    };
  }

  return {
    explorationRunId: input.artifact.explorationRunId,
    compatible: true,
    matchedActions: input.artifact.actionCache.length
  };
}
