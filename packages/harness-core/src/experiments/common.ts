import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sumAiUsageSummaries, summarizeUsageCosts } from "../ai/usage.js";
import type { ResolvedBenchmarkSuite, ScenarioRunResult, UsageCostSummary } from "../types.js";
import type { AiUsagePhase, AutomationRunner, Finding, ModelAvailability, RunWorkspace } from "../types.js";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "../cache/config.js";
import { summarizeScenarioRunCache } from "../cache/summary.js";
import { loadPromptText } from "../config/prompt.js";
import { buildSourceCandidates } from "../diagnostics/source-candidates.js";
import { classifyFailure } from "../diagnostics/taxonomy.js";
import { persistScenarioArtifacts } from "../persistence/store.js";
import { nowIso } from "../utils/time.js";
import { resolveWorkspacePath } from "../utils/fs.js";
import type {
  CapabilityDefinition,
  ExperimentKind,
  ExperimentLogFn,
  ExperimentRuntime,
  RepairPromptContext,
  ResolvedAppBenchmark
} from "./types.js";

export const DEFAULT_EXPERIMENT_PARALLELISM = 2;

function avg(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

export function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function truncateLogText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1_000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

export function emitExperimentLog(onLog: ExperimentLogFn | undefined, message: string): void {
  if (!onLog) {
    return;
  }

  try {
    onLog(message);
  } catch {
    // Logging must never break benchmark execution.
  }
}

function describeScenarioResult(result: ScenarioRunResult): string {
  const status = result.success ? "passed" : "failed";
  const cache = result.cache?.status ? `, cache ${result.cache.status}` : "";
  const detailSource = result.success ? result.message : result.error ?? result.message;
  const detail = detailSource ? `, ${truncateLogText(detailSource)}` : "";
  return `${status} in ${formatDurationMs(result.latencyMs)}${cache}${detail}`;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function computeBinaryStability(groups: number[][]): number {
  if (!groups.length) {
    return 0;
  }
  const maxBinaryStd = 0.5;
  return round(clamp(1 - avg(groups.map((group) => std(group) / maxBinaryStd))));
}

export function computeLatencyEfficiency(avgLatencyMs: number, pivotMs = 2_000): number {
  return round(1 / (1 + avgLatencyMs / pivotMs));
}

export function computeCostEfficiency(avgCostUsd: number, pivotUsd = 0.05): number {
  return round(1 / (1 + avgCostUsd / pivotUsd));
}

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function experimentOutputDirName(kind: ExperimentKind): string {
  return kind === "qa" ? "guided" : kind;
}

export async function resolveExperimentRoot(resultsDir: string, kind: ExperimentKind): Promise<string> {
  return join(await resolveWorkspacePath(resultsDir), experimentOutputDirName(kind));
}

export function resolveParallelism(value: number | undefined, fallback = DEFAULT_EXPERIMENT_PARALLELISM): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`parallelism must be a positive integer, got ${value}`);
  }
  return Math.max(1, Math.floor(value));
}

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (firstError === undefined) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          return;
        }

        try {
          results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
        } catch (error) {
          firstError = error;
          return;
        }
      }
    })
  );

  if (firstError !== undefined) {
    throw firstError;
  }

  return results;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function mapCapabilityTasks(
  resolvedBenchmark: ResolvedAppBenchmark,
  capabilityIds: string[]
): Array<CapabilityDefinition & { scenarios: ScenarioRunResult[] }> {
  return capabilityIds.map((capabilityId) => ({
    ...resolvedBenchmark.capabilityMap.get(capabilityId)!,
    scenarios: []
  }));
}

export function selectScenarios(resolvedBenchmark: ResolvedAppBenchmark, scenarioIds: string[]) {
  return scenarioIds.map((scenarioId) => {
    const scenario = resolvedBenchmark.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`unknown scenario ${scenarioId}`);
    }
    return scenario;
  });
}

export async function buildResolvedSuite(input: {
  resolvedBenchmark: ResolvedAppBenchmark;
  scenarioIds: string[];
  bugIds: string[];
  explorationMode: "guided" | "autonomous";
  suiteId: string;
  resultsDir: string;
  runtime: ExperimentRuntime;
  promptIds: {
    guided?: string;
    autonomous?: string;
    repair?: string;
  };
}): Promise<ResolvedBenchmarkSuite> {
  const selectedScenarios = selectScenarios(input.resolvedBenchmark, input.scenarioIds);
  const selectedBugs = input.resolvedBenchmark.target.bugs.filter((bug) => input.bugIds.includes(bug.bugId));

  return {
    suitePath: input.resolvedBenchmark.manifestPath,
    suite: {
      suiteId: input.suiteId,
      targetId: input.resolvedBenchmark.target.target.targetId,
      scenarioIds: input.scenarioIds,
      bugIds: input.bugIds,
      explorationMode: input.explorationMode,
      promptIds: input.promptIds,
      profile: input.runtime.profile,
      trials: 1,
      timeoutMs: input.runtime.timeoutMs,
      retryCount: input.runtime.retryCount,
      maxSteps: input.runtime.maxSteps,
      maxOutputTokens: input.runtime.maxOutputTokens,
      viewport: input.runtime.viewport,
      seed: 1,
      resultsDir: input.resultsDir
    },
    target: input.resolvedBenchmark.target,
    selectedScenarios,
    selectedBugs,
    prompts: {
      guided: input.promptIds.guided ? await loadPromptText(input.promptIds.guided) : undefined,
      autonomous: input.promptIds.autonomous ? await loadPromptText(input.promptIds.autonomous) : undefined,
      repair: input.promptIds.repair ? await loadPromptText(input.promptIds.repair) : undefined
    }
  };
}

function severityFromCategory(category: ReturnType<typeof classifyFailure>): "low" | "medium" | "high" {
  if (category === "timeout" || category === "navigation") {
    return "high";
  }
  if (category === "assertion" || category === "locator") {
    return "medium";
  }
  return "low";
}

function firstFailedAssertion(result: ScenarioRunResult) {
  for (const step of result.stepRuns) {
    if (step.success) {
      continue;
    }
    const failedAssertion = step.assertionRuns.find((assertion) => !assertion.success);
    return { step, failedAssertion };
  }
  return undefined;
}

export async function executeGuidedScenarios(input: {
  runId: string;
  resultsRoot: string;
  resolvedSuite: ResolvedBenchmarkSuite;
  workspace: RunWorkspace;
  model: ModelAvailability;
  runner: AutomationRunner;
  trial: number;
  systemPrompt?: string;
  includeFindings?: boolean;
  includeBugHints?: boolean;
  scenarioIds?: string[];
  usagePhase?: AiUsagePhase;
  onLog?: ExperimentLogFn;
  scenarioLabel?: string;
  onScenarioRunComplete?: (event: {
    scenarioIndex: number;
    totalScenarios: number;
    scenarioId: string;
    result: ScenarioRunResult;
  }) => Promise<void> | void;
}): Promise<{
  scenarioRuns: ScenarioRunResult[];
  findings: Finding[];
}> {
  const scenarioRuns: ScenarioRunResult[] = [];
  const findings: Finding[] = [];
  const selectedScenarioIds = input.scenarioIds ? new Set(input.scenarioIds) : undefined;
  const selectedScenarios = input.resolvedSuite.selectedScenarios.filter(
    (scenario) => !selectedScenarioIds || selectedScenarioIds.has(scenario.scenarioId)
  );
  const cacheConfig = await resolveExecutionCacheConfig({
    resultsDir: input.resolvedSuite.suite.resultsDir,
    targetId: input.resolvedSuite.suite.targetId,
    bugIds: input.resolvedSuite.suite.bugIds,
    viewport: input.resolvedSuite.suite.viewport,
    modelId: input.model.id,
    configSignature: buildStagehandConfigSignature({
      executionKind: "guided",
      systemPrompt: input.systemPrompt
    })
  });

  for (const [scenarioIndex, scenario] of selectedScenarios.entries()) {
    const scenarioLabel = input.scenarioLabel ?? "scenario";
    emitExperimentLog(
      input.onLog,
      `${scenarioLabel} ${scenarioIndex + 1}/${selectedScenarios.length} (${scenario.scenarioId}) started`
    );
    const result = await input.runner.runScenario({
      model: input.model,
      scenario,
      trial: input.trial,
      aut: input.workspace.aut,
      runConfig: {
        profile: input.resolvedSuite.suite.profile,
        timeoutMs: input.resolvedSuite.suite.timeoutMs,
        retryCount: input.resolvedSuite.suite.retryCount,
        maxSteps: input.resolvedSuite.suite.maxSteps,
        maxOutputTokens: input.resolvedSuite.suite.maxOutputTokens,
        viewport: input.resolvedSuite.suite.viewport
      },
      cacheConfig,
      usagePhase: input.usagePhase,
      systemPrompt: input.systemPrompt
    });
    scenarioRuns.push(result);
    await input.onScenarioRunComplete?.({
      scenarioIndex,
      totalScenarios: selectedScenarios.length,
      scenarioId: scenario.scenarioId,
      result
    });
    emitExperimentLog(
      input.onLog,
      `${scenarioLabel} ${scenarioIndex + 1}/${selectedScenarios.length} (${scenario.scenarioId}) ${describeScenarioResult(result)}`
    );

    if (!input.includeFindings || result.success) {
      continue;
    }

    const artifactRefs = await persistScenarioArtifacts(input.resultsRoot, input.runId, input.model.id, result);
    const failure = firstFailedAssertion(result);
    const reason = failure?.failedAssertion?.error ?? failure?.failedAssertion?.message ?? result.error ?? result.message;
    const category = classifyFailure(reason);
    findings.push({
      id: `${input.runId}:${input.model.id}:${scenario.scenarioId}:${failure?.step.stepId ?? "unknown"}:${input.trial}`,
      runId: input.runId,
      modelId: input.model.id,
      scenarioId: scenario.scenarioId,
      stepId: failure?.step.stepId ?? "unknown",
      assertionId: failure?.failedAssertion?.assertionId,
      trial: input.trial,
      severity: severityFromCategory(category),
      category,
      message: reason,
      artifacts: artifactRefs,
      sourceCandidates: buildSourceCandidates({
        workspacePath: input.workspace.workspacePath,
        suite: input.resolvedSuite,
        scenario,
        result,
        category,
        message: reason,
        includeBugHints: input.includeBugHints ?? true
      }),
      createdAt: nowIso()
    });
  }

  return { scenarioRuns, findings };
}

export function groupScenarioOutcomesByScenario(scenarioRuns: ScenarioRunResult[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const run of scenarioRuns) {
    const current = groups.get(run.scenarioId) ?? [];
    current.push(run.success ? 1 : 0);
    groups.set(run.scenarioId, current);
  }
  return [...groups.values()];
}

export function summarizeScenarioRuns(scenarioRuns: ScenarioRunResult[]): {
  scenarioPassRate: number;
  stepPassRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  costSummary: UsageCostSummary;
  stability: number;
  usageSummary: ReturnType<typeof sumAiUsageSummaries>;
  cacheSummary?: ReturnType<typeof summarizeScenarioRunCache>;
} {
  const successes = scenarioRuns.filter((run) => run.success).length;
  const scenarioPassRate = scenarioRuns.length ? successes / scenarioRuns.length : 0;
  const stepRuns = scenarioRuns.flatMap((run) => run.stepRuns);
  const passedSteps = stepRuns.filter((step) => step.success).length;
  const stepPassRate = stepRuns.length ? passedSteps / stepRuns.length : 0;
  const usageSummaries = scenarioRuns.map((run) => run.usageSummary);
  const usageSummary = sumAiUsageSummaries(usageSummaries);
  const costSummary = summarizeUsageCosts(usageSummaries, scenarioRuns.length);
  return {
    scenarioPassRate: round(scenarioPassRate),
    stepPassRate: round(stepPassRate),
    avgLatencyMs: round(avg(scenarioRuns.map((run) => run.latencyMs)), 3),
    avgCostUsd: costSummary.avgResolvedUsd,
    costSummary,
    stability: computeBinaryStability(groupScenarioOutcomesByScenario(scenarioRuns)),
    usageSummary,
    cacheSummary: summarizeScenarioRunCache(scenarioRuns)
  };
}

export async function readCandidateFileSnippets(input: {
  workspacePath: string;
  candidates: Array<{ workspaceRelativePath: string; reasons: string[] }>;
  limit?: number;
  maxChars?: number;
}): Promise<RepairPromptContext["candidateFiles"]> {
  const selected = input.candidates.slice(0, input.limit ?? 3);
  const maxChars = input.maxChars ?? 4_000;
  const files: RepairPromptContext["candidateFiles"] = [];

  for (const candidate of selected) {
    const fullPath = join(input.workspacePath, ...normalizePath(candidate.workspaceRelativePath).split("/"));
    try {
      const raw = await readFile(fullPath, "utf8");
      files.push({
        path: candidate.workspaceRelativePath,
        reasons: candidate.reasons,
        content: raw.slice(0, maxChars)
      });
    } catch {
      continue;
    }
  }

  return files;
}
