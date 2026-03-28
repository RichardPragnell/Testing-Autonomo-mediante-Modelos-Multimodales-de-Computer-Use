import type { CacheTelemetry, CacheUsageSummary, TaskRunResult } from "../types.js";

function summarizeSharedValue(values: string[]): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) {
    return "";
  }
  if (unique.length === 1) {
    return unique[0]!;
  }
  return "mixed";
}

export function summarizeCacheTelemetry(entries: CacheTelemetry[]): CacheUsageSummary | undefined {
  if (!entries.length) {
    return undefined;
  }

  return {
    rootDir: summarizeSharedValue(entries.map((entry) => entry.rootDir)),
    namespace: summarizeSharedValue(entries.map((entry) => entry.namespace)),
    configSignature: summarizeSharedValue(entries.map((entry) => entry.configSignature)),
    total: entries.length,
    hits: entries.filter((entry) => entry.status === "hit").length,
    misses: entries.filter((entry) => entry.status === "miss").length,
    refreshedAfterFailure: entries.filter((entry) => entry.status === "refreshed_after_failure").length,
    aiInvocations: entries.filter((entry) => entry.aiInvoked).length,
    warnings: [...new Set(entries.flatMap((entry) => entry.warnings))],
    modes: [...new Set(entries.map((entry) => entry.mode))].sort()
  };
}

export function summarizeTaskRunCache(taskRuns: TaskRunResult[]): CacheUsageSummary | undefined {
  return summarizeCacheTelemetry(taskRuns.flatMap((taskRun) => (taskRun.cache ? [taskRun.cache] : [])));
}
