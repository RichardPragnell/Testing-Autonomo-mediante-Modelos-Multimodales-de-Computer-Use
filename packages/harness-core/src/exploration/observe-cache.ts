import { join } from "node:path";
import type { ExecutionCacheConfig, ObserveCacheEntry, ObservedAction } from "../types.js";
import { sha256, stableTextHash } from "../utils/hash.js";
import { readText, writeJson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";
import { normalizeObservedAction } from "./action-cache.js";

function normalizeInstruction(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function observeCachePath(cacheConfig: ExecutionCacheConfig): string {
  return join(cacheConfig.cacheDir, "observe-cache.json");
}

export function buildObserveCacheKey(input: {
  instruction: string;
  url: string;
  stateId: string;
  domHash: string;
  visualHash: string;
}): string {
  return sha256(
    JSON.stringify({
      instruction: normalizeInstruction(input.instruction),
      url: input.url,
      stateId: input.stateId,
      domHash: input.domHash,
      visualHash: input.visualHash
    })
  );
}

function normalizeObserveCacheEntry(entry: ObserveCacheEntry): ObserveCacheEntry {
  return {
    ...entry,
    instruction: normalizeInstruction(entry.instruction),
    actions: entry.actions.map(normalizeObservedAction)
  };
}

export async function loadObserveCache(cacheConfig: ExecutionCacheConfig): Promise<ObserveCacheEntry[]> {
  try {
    const raw = await readText(observeCachePath(cacheConfig));
    const parsed = JSON.parse(raw) as ObserveCacheEntry[];
    return Array.isArray(parsed) ? parsed.map(normalizeObserveCacheEntry) : [];
  } catch {
    return [];
  }
}

export async function saveObserveCache(
  cacheConfig: ExecutionCacheConfig,
  entries: ObserveCacheEntry[]
): Promise<void> {
  await writeJson(observeCachePath(cacheConfig), entries);
}

export function findObserveCacheEntry(
  entries: ObserveCacheEntry[],
  input: {
    instruction: string;
    url: string;
    stateId: string;
    domHash: string;
    visualHash: string;
  }
): ObserveCacheEntry | undefined {
  const key = buildObserveCacheKey(input);
  return entries.find((entry) => entry.key === key);
}

export function markObserveCacheHit(entries: ObserveCacheEntry[], entryId: string): ObserveCacheEntry[] {
  return entries.map((entry) =>
    entry.entryId === entryId
      ? {
          ...entry,
          hitCount: entry.hitCount + 1,
          updatedAt: nowIso()
        }
      : entry
  );
}

export function upsertObserveCacheEntry(
  entries: ObserveCacheEntry[],
  input: {
    instruction: string;
    url: string;
    stateId: string;
    domHash: string;
    visualHash: string;
    actions: ObservedAction[];
  }
): ObserveCacheEntry[] {
  const key = buildObserveCacheKey(input);
  const normalizedActions = input.actions.map(normalizeObservedAction);
  const existing = entries.find((entry) => entry.key === key);
  if (existing) {
    return entries.map((entry) =>
      entry.key === key
        ? {
            ...entry,
            actions: normalizedActions,
            updatedAt: nowIso()
          }
        : entry
    );
  }

  const instruction = normalizeInstruction(input.instruction);
  return [
    ...entries,
    {
      entryId: stableTextHash(`${key}|${instruction}`),
      key,
      instruction,
      stateId: input.stateId,
      url: input.url,
      domHash: input.domHash,
      visualHash: input.visualHash,
      actions: normalizedActions,
      hitCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];
}
