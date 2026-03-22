import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedBenchmarkSuite, TaskRunResult } from "../types.js";
import type { ActionCacheEntry, AutomationRunner, Finding, ModelAvailability, RunWorkspace } from "../types.js";
import { loadPromptText } from "../config/prompt.js";
import { persistTaskArtifacts } from "../persistence/store.js";
import { buildSourceCandidates } from "../diagnostics/source-candidates.js";
import { classifyFailure } from "../diagnostics/taxonomy.js";
import { nowIso } from "../utils/time.js";
import { resolveWorkspacePath } from "../utils/fs.js";
import type {
  CapabilityDefinition,
  ExperimentKind,
  ExperimentRuntime,
  RepairPromptContext,
  ResolvedAppBenchmark
} from "./types.js";

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

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function computeBinaryStability(groups: number[][]): number {
  if (!groups.length) {
    return 0;
  }
  return round(clamp(1 - avg(groups.map((group) => std(group)))));
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

export async function resolveExperimentRoot(resultsDir: string, kind: ExperimentKind): Promise<string> {
  return join(await resolveWorkspacePath(resultsDir), kind);
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function mapCapabilityTasks(
  resolvedBenchmark: ResolvedAppBenchmark,
  capabilityIds: string[]
): Array<CapabilityDefinition & { tasks: TaskRunResult[] }> {
  return capabilityIds.map((capabilityId) => ({
    ...resolvedBenchmark.capabilityMap.get(capabilityId)!,
    tasks: []
  }));
}

export function selectTasks(resolvedBenchmark: ResolvedAppBenchmark, taskIds: string[]) {
  return taskIds.map((taskId) => {
    const task = resolvedBenchmark.tasks.get(taskId);
    if (!task) {
      throw new Error(`unknown task ${taskId}`);
    }
    return task;
  });
}

export async function buildResolvedSuite(input: {
  resolvedBenchmark: ResolvedAppBenchmark;
  taskIds: string[];
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
  const tasks = selectTasks(input.resolvedBenchmark, input.taskIds);
  const scenarioIds = unique(tasks.map((task) => task.scenarioId).filter((value): value is string => Boolean(value)));
  const selectedScenarios = input.resolvedBenchmark.target.scenarios.filter((scenario) =>
    scenarioIds.includes(scenario.scenarioId)
  );
  const selectedBugs = input.resolvedBenchmark.target.bugs.filter((bug) => input.bugIds.includes(bug.bugId));

  return {
    suitePath: input.resolvedBenchmark.manifestPath,
    suite: {
      suiteId: input.suiteId,
      targetId: input.resolvedBenchmark.target.target.targetId,
      scenarioIds,
      bugIds: input.bugIds,
      explorationMode: input.explorationMode,
      promptIds: input.promptIds,
      trials: 1,
      timeoutMs: input.runtime.timeoutMs,
      retryCount: input.runtime.retryCount,
      maxSteps: input.runtime.maxSteps,
      viewport: input.runtime.viewport,
      seed: 1,
      resultsDir: input.resultsDir
    },
    target: input.resolvedBenchmark.target,
    selectedScenarios,
    selectedBugs,
    tasks,
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

export async function executeGuidedTasks(input: {
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
  cacheHints?: Map<string, ActionCacheEntry[]>;
  taskIds?: string[];
}): Promise<{
  taskRuns: TaskRunResult[];
  findings: Finding[];
}> {
  const taskRuns: TaskRunResult[] = [];
  const findings: Finding[] = [];
  const selectedTaskIds = input.taskIds ? new Set(input.taskIds) : undefined;

  for (const task of input.resolvedSuite.tasks) {
    if (selectedTaskIds && !selectedTaskIds.has(task.id)) {
      continue;
    }
    const result = await input.runner.runTask({
      model: input.model,
      task,
      trial: input.trial,
      aut: input.workspace.aut,
      runConfig: {
        timeoutMs: input.resolvedSuite.suite.timeoutMs,
        retryCount: input.resolvedSuite.suite.retryCount,
        maxSteps: input.resolvedSuite.suite.maxSteps,
        viewport: input.resolvedSuite.suite.viewport
      },
      systemPrompt: input.systemPrompt,
      cacheHints: input.cacheHints?.get(task.id)
    });
    taskRuns.push(result);

    if (!input.includeFindings || result.success) {
      continue;
    }

    const artifactRefs = await persistTaskArtifacts(input.resultsRoot, input.runId, input.model.id, result);
    const reason = result.error ?? result.message;
    const category = classifyFailure(reason);
    findings.push({
      id: `${input.runId}:${input.model.id}:${task.id}:${input.trial}`,
      runId: input.runId,
      modelId: input.model.id,
      taskId: task.id,
      trial: input.trial,
      severity: severityFromCategory(category),
      category,
      message: reason,
      artifacts: artifactRefs,
      sourceCandidates: buildSourceCandidates({
        workspacePath: input.workspace.workspacePath,
        suite: input.resolvedSuite,
        task,
        result,
        category,
        message: reason,
        includeBugHints: input.includeBugHints ?? true
      }),
      createdAt: nowIso()
    });
  }

  return { taskRuns, findings };
}

export function groupTaskOutcomesByTask(taskRuns: TaskRunResult[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const run of taskRuns) {
    const current = groups.get(run.taskId) ?? [];
    current.push(run.success ? 1 : 0);
    groups.set(run.taskId, current);
  }
  return [...groups.values()];
}

export function summarizeTaskRuns(taskRuns: TaskRunResult[]): {
  taskPassRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  stability: number;
} {
  const successes = taskRuns.filter((run) => run.success).length;
  const taskPassRate = taskRuns.length ? successes / taskRuns.length : 0;
  return {
    taskPassRate: round(taskPassRate),
    avgLatencyMs: round(avg(taskRuns.map((run) => run.latencyMs)), 3),
    avgCostUsd: round(avg(taskRuns.map((run) => run.costUsd))),
    stability: computeBinaryStability(groupTaskOutcomesByTask(taskRuns))
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
