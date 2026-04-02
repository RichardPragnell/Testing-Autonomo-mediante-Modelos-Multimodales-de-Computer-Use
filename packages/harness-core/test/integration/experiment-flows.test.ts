import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareBenchmarkRuns,
  compareQaRuns,
  rebuildBenchmarkReports,
  runBenchmarkSuite,
  runExploreAcrossApps,
  runExploreExperiment,
  runHealAcrossApps,
  runHealExperiment,
  runQaAcrossApps,
  runQaExperiment
} from "../../src/index.js";
import { MockAutomationRunner } from "../../src/runner/mock-runner.js";
import { MockRepairModelClient, type RepairModelClient } from "../../src/self-heal/model-client.js";
import { nowIso } from "../../src/utils/time.js";
import type { AutomationRunner, ExplorationArtifact, RunTaskInput, TaskRunResult } from "../../src/types.js";

const tempDirs: string[] = [];
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await removeDirWithRetries(dir);
    }
  }

  if (originalOpenRouterKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

async function removeDirWithRetries(dir: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === attempts) {
        throw error;
      }
      await delay(200 * attempt);
    }
  }
}

async function writeRegistry(dir: string, models: string[]): Promise<string> {
  const path = join(dir, "registry.yaml");
  const lines = ["default_model: " + models[0], "models:"];
  for (const modelId of models) {
    lines.push(`  - id: ${modelId}`);
    lines.push(`    provider: ${modelId.split("/")[0]}`);
    lines.push("    enabled: true");
  }
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

const TODO_STORE_PATHS = ["src/todo-store.js", "app/todo-store.js", "src/app/todo-store.ts"];

async function readTodoStore(workspacePath: string): Promise<{
  path: string;
  content: string;
}> {
  for (const relativePath of TODO_STORE_PATHS) {
    try {
      const content = (await readFile(join(workspacePath, relativePath), "utf8")).replaceAll("\r\n", "\n");
      return {
        path: relativePath,
        content
      };
    } catch {
      continue;
    }
  }

  throw new Error(`todo store not found in ${workspacePath}`);
}

function inferBugId(taskIds: Set<string>): string | undefined {
  if (taskIds.has("guided-add-task")) {
    return "new-task-label-lost";
  }
  if (taskIds.has("guided-edit-task")) {
    return "edit-task-save-noop";
  }
  if (taskIds.has("guided-complete-task") || taskIds.has("guided-filter-active")) {
    return "toggle-completion-noop";
  }
  return undefined;
}

function reverseUnifiedDiff(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (
        line.startsWith("diff --git ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@") ||
        line === "\\ No newline at end of file"
      ) {
        return line;
      }
      if (line.startsWith("+")) {
        return `-${line.slice(1)}`;
      }
      if (line.startsWith("-")) {
        return `+${line.slice(1)}`;
      }
      return line;
    })
    .join("\n");
}

function createCrossFrameworkRepairClient(): RepairModelClient {
  return {
    async repair(input) {
      const failingTaskIds = new Set(input.context.findings.map((finding) => finding.taskId));
      const bugId = inferBugId(failingTaskIds);
      let patch: string | undefined;
      let suspectedFiles: string[] = [];
      let summary = "No likely fix found.";

      if (bugId) {
        const bugPatch = await readFile(
          new URL(`../../../../apps/${input.context.appId}/bugs/${bugId}/patch.diff`, import.meta.url),
          "utf8"
        );
        patch = reverseUnifiedDiff(bugPatch);
        suspectedFiles = [...new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]))];
        summary = `Revert benchmark bug ${bugId} in the shared todo store.`;
      }

      return {
        diagnosis: {
          summary,
          suspectedFiles
        },
        patch,
        usage: {
          latencyMs: 20,
          inputTokens: 120,
          outputTokens: 240,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 360,
          costUsd: 0.00036,
          resolvedCostUsd: 0.00036,
          costSource: "estimated",
          callCount: 1,
          unavailableCalls: 0
        },
        rawResponse: JSON.stringify({
          diagnosisSummary: summary,
          suspectedFiles,
          patch
        })
      };
    }
  };
}

class RichExploreRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const success = input.task.id.startsWith("smoke") || input.cacheConfig.namespace.length > 0;
    const cacheStatus = input.trial > 1 ? "hit" : "miss";
    const usageSummary = {
      latencyMs: 120,
      inputTokens: 300,
      outputTokens: 90,
      reasoningTokens: 0,
      cachedInputTokens: cacheStatus === "hit" ? 40 : 0,
      totalTokens: 390,
      costUsd: 0.003,
      resolvedCostUsd: 0.003,
      costSource: "exact" as const,
      callCount: 1,
      unavailableCalls: 0
    };
    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success,
      message: success ? "probe replay succeeded" : "probe replay failed",
      latencyMs: 120,
      costUsd: 0.003,
      usageSummary,
      aiCalls: [
        {
          phase: input.usagePhase ?? "probe_replay",
          operation: "agent",
          requestedModelId: input.model.id,
          requestedProvider: input.model.provider,
          servedModelId: input.model.id,
          servedProvider: input.model.provider,
          generationId: `rich-probe-${input.task.id}-${input.trial}`,
          costSource: "exact",
          costUsd: 0.003,
          latencyMs: 120,
          inputTokens: 300,
          outputTokens: 90,
          reasoningTokens: 0,
          cachedInputTokens: usageSummary.cachedInputTokens,
          totalTokens: 390,
          timestamp: nowIso()
        }
      ],
      urlAfter: input.aut.url,
      trace: [
        {
          timestamp: nowIso(),
          action: "rich.probe",
          details: {
            taskId: input.task.id,
            cacheNamespace: input.cacheConfig.namespace,
            cacheStatus
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "agent_native",
        status: cacheStatus,
        aiInvoked: cacheStatus !== "hit",
        warnings: []
      }
    };
  }

  async exploreTarget(input: {
    model: RunTaskInput["model"];
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: RunTaskInput["aut"];
    runConfig: RunTaskInput["runConfig"];
    cacheConfig: RunTaskInput["cacheConfig"];
    workspacePath: string;
  }): Promise<ExplorationArtifact> {
    const observeCache = [
      {
        entryId: "observe-s1",
        key: "observe-s1-key",
        instruction: input.prompt,
        stateId: "s1",
        url: input.aut.url,
        domHash: "dom-1",
        visualHash: "vis-1",
        actions: [],
        hitCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ];

    return {
      explorationRunId: `rich-explore-${input.trial}`,
      targetId: input.targetId,
      bugIds: [],
      modelId: input.model.id,
      trial: input.trial,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      compatibility: {
        targetId: input.targetId,
        bugIds: [],
        viewport: input.runConfig.viewport
      },
      history: [],
      pages: [
        {
          id: "s1",
          url: input.aut.url,
          domHash: "dom-1",
          visualHash: "vis-1",
          summary: "Root page",
          availableActions: [],
          visitCount: 1
        },
        {
          id: "s2",
          url: input.aut.url,
          domHash: "dom-2",
          visualHash: "vis-2",
          summary: "Composer focused",
          availableActions: [],
          visitCount: 1
        },
        {
          id: "s3",
          url: input.aut.url,
          domHash: "dom-3",
          visualHash: "vis-3",
          summary: "Filter active",
          availableActions: [],
          visitCount: 1
        },
        {
          id: "s4",
          url: input.aut.url,
          domHash: "dom-4",
          visualHash: "vis-4",
          summary: "Editing item",
          availableActions: [],
          visitCount: 1
        }
      ],
      coverageGraph: {
        nodes: [
          { id: "s1", url: input.aut.url, domHash: "dom-1", visualHash: "vis-1", visits: 1 },
          { id: "s2", url: input.aut.url, domHash: "dom-2", visualHash: "vis-2", visits: 1 },
          { id: "s3", url: input.aut.url, domHash: "dom-3", visualHash: "vis-3", visits: 1 },
          { id: "s4", url: input.aut.url, domHash: "dom-4", visualHash: "vis-4", visits: 1 }
        ],
        edges: [
          { from: "s1", to: "s2", action: "add task", count: 1 },
          { from: "s2", to: "s3", action: "filter active", count: 1 },
          { from: "s3", to: "s4", action: "edit task", count: 1 }
        ]
      },
      actionCache: [
        {
          actionId: "add-task",
          stateId: "s1",
          url: input.aut.url,
          domHash: "dom-1",
          visualHash: "vis-1",
          selector: "input[name='todo']",
          description: "Add a new task",
          method: "fill",
          arguments: ["Review benchmark notes"],
          signature: "sig-add",
          instructionHints: ["add task", "new task"],
          observationCount: 1,
          executionCount: 0
        },
        {
          actionId: "toggle-task",
          stateId: "s2",
          url: input.aut.url,
          domHash: "dom-2",
          visualHash: "vis-2",
          selector: "input[type='checkbox']",
          description: "Toggle task completion",
          method: "click",
          arguments: [],
          signature: "sig-toggle",
          instructionHints: ["complete task"],
          observationCount: 1,
          executionCount: 0
        },
        {
          actionId: "filter-active",
          stateId: "s2",
          url: input.aut.url,
          domHash: "dom-2",
          visualHash: "vis-2",
          selector: "button[data-filter='active']",
          description: "Open active filter",
          method: "click",
          arguments: [],
          signature: "sig-filter",
          instructionHints: ["active filter"],
          observationCount: 1,
          executionCount: 0
        },
        {
          actionId: "edit-task",
          stateId: "s3",
          url: input.aut.url,
          domHash: "dom-3",
          visualHash: "vis-3",
          selector: "button[data-action='edit']",
          description: "Edit the selected task",
          method: "click",
          arguments: [],
          signature: "sig-edit",
          instructionHints: ["edit task", "outline"],
          observationCount: 1,
          executionCount: 0
        },
        {
          actionId: "delete-task",
          stateId: "s4",
          url: input.aut.url,
          domHash: "dom-4",
          visualHash: "vis-4",
          selector: "button[data-action='delete']",
          description: "Delete the selected task",
          method: "click",
          arguments: [],
          signature: "sig-delete",
          instructionHints: ["remove task", "delete task"],
          observationCount: 1,
          executionCount: 0
        }
      ],
      observeCache,
      cacheSummary: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        total: 1,
        hits: 0,
        misses: 1,
        refreshedAfterFailure: 0,
        aiInvocations: 1,
        warnings: [],
        modes: ["observe_manual"]
      },
      usageSummary: {
        latencyMs: 880,
        inputTokens: 1250,
        outputTokens: 330,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 1580,
        costUsd: 0.011,
        resolvedCostUsd: 0.011,
        costSource: "exact",
        callCount: 2,
        unavailableCalls: 0
      },
      aiCalls: [
        {
          phase: "exploration",
          operation: "observe",
          requestedModelId: input.model.id,
          requestedProvider: input.model.provider,
          servedModelId: input.model.id,
          servedProvider: input.model.provider,
          generationId: `rich-explore-observe-${input.trial}`,
          costSource: "exact",
          costUsd: 0.006,
          latencyMs: 440,
          inputTokens: 700,
          outputTokens: 170,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 870,
          timestamp: nowIso()
        },
        {
          phase: "exploration",
          operation: "act",
          requestedModelId: input.model.id,
          requestedProvider: input.model.provider,
          servedModelId: input.model.id,
          servedProvider: input.model.provider,
          generationId: `rich-explore-act-${input.trial}`,
          costSource: "exact",
          costUsd: 0.005,
          latencyMs: 440,
          inputTokens: 550,
          outputTokens: 160,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 710,
          timestamp: nowIso()
        }
      ],
      trace: [
        {
          timestamp: nowIso(),
          action: "rich.explore",
          details: {
            cacheNamespace: input.cacheConfig.namespace
          }
        }
      ],
      summary: {
        statesDiscovered: 4,
        transitionsDiscovered: 3,
        actionsCached: 5,
        observeCacheEntries: observeCache.length,
        historyEntries: 0
      }
    };
  }
}

class BugAwareRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const cwd = input.aut.cwd!;
    const { content: store } = await readTodoStore(cwd);
    const addBroken = store.includes('text: "New task"');
    const toggleBlock = store.slice(
      store.indexOf("export function toggleTodo"),
      store.indexOf("export function updateTodoText")
    );
    const updateBlock = store.slice(
      store.indexOf("export function updateTodoText"),
      store.indexOf("export function removeTodo")
    );
    const toggleBroken = toggleBlock.includes("return todos;") && !toggleBlock.includes("done: !todo.done");
    const editBroken = updateBlock.includes("\n  return todos;\n") && !updateBlock.includes("text: trimmed");

    const success =
      input.task.id === "guided-add-task"
        ? !addBroken
        : input.task.id === "guided-complete-task" || input.task.id === "guided-filter-active"
          ? !toggleBroken
          : input.task.id === "guided-edit-task"
            ? !editBroken
            : true;

    const usageSummary = {
      latencyMs: 90,
      inputTokens: 240,
      outputTokens: 75,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 315,
      costUsd: 0.002,
      resolvedCostUsd: 0.002,
      costSource: "exact" as const,
      callCount: 1,
      unavailableCalls: 0
    };

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success,
      message: success ? "task passed" : "task failed",
      latencyMs: 90,
      costUsd: 0.002,
      usageSummary,
      aiCalls: [
        {
          phase: input.usagePhase ?? "guided_task",
          operation: "agent",
          requestedModelId: input.model.id,
          requestedProvider: input.model.provider,
          servedModelId: input.model.id,
          servedProvider: input.model.provider,
          generationId: `bug-aware-${input.task.id}-${input.trial}`,
          costSource: "exact",
          costUsd: 0.002,
          latencyMs: 90,
          inputTokens: 240,
          outputTokens: 75,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 315,
          timestamp: nowIso()
        }
      ],
      urlAfter: input.aut.url,
      domSnapshot: success ? "<html><body><h1>ok</h1></body></html>" : "<html><body><h1>Mismatch</h1></body></html>",
      trace: [
        {
          timestamp: nowIso(),
          action: "bug-aware.run",
          details: {
            taskId: input.task.id,
            cacheNamespace: input.cacheConfig.namespace
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "agent_native",
        status: "miss",
        aiInvoked: true,
        warnings: []
      },
      error: success ? undefined : "expected app behavior not observed"
    };
  }
}

class UnavailableCostRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success: true,
      message: "task passed",
      latencyMs: 75,
      costUsd: undefined,
      usageSummary: {
        latencyMs: 75,
        inputTokens: 180,
        outputTokens: 40,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 220,
        costUsd: undefined,
        resolvedCostUsd: 0,
        costSource: "unavailable",
        callCount: 1,
        unavailableCalls: 1
      },
      aiCalls: [
        {
          phase: input.usagePhase ?? "guided_task",
          operation: "agent",
          requestedModelId: input.model.id,
          requestedProvider: input.model.provider,
          costSource: "unavailable",
          latencyMs: 75,
          inputTokens: 180,
          outputTokens: 40,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 220,
          timestamp: nowIso(),
          error: "provider response did not include exact usage cost"
        }
      ],
      urlAfter: input.aut.url,
      trace: [
        {
          timestamp: nowIso(),
          action: "unavailable-cost.run",
          details: {
            taskId: input.task.id
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "agent_native",
        status: "miss",
        aiInvoked: true,
        warnings: []
      }
    };
  }
}

class WorkspaceIsolationRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const workspacePath = input.aut.cwd;
    if (!workspacePath) {
      throw new Error("workspace path missing from AUT config");
    }

    const markerPath = join(workspacePath, "workspace-marker.txt");
    let inheritedFrom: string | undefined;
    try {
      inheritedFrom = (await readFile(markerPath, "utf8")).trim() || undefined;
    } catch {
      inheritedFrom = undefined;
    }

    await writeFile(markerPath, input.model.id, "utf8");

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success: inheritedFrom === undefined || inheritedFrom === input.model.id,
      message: inheritedFrom ? `workspace inherited from ${inheritedFrom}` : "fresh workspace",
      latencyMs: 25,
      costUsd: 0.001,
      usageSummary: {
        latencyMs: 25,
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 15,
        costUsd: 0.001,
        resolvedCostUsd: 0.001,
        costSource: "exact",
        callCount: 1,
        unavailableCalls: 0
      },
      aiCalls: [],
      urlAfter: input.aut.url,
      trace: [
        {
          timestamp: nowIso(),
          action: "workspace.check",
          details: {
            workspacePath,
            inheritedFrom: inheritedFrom ?? null
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "act_native",
        status: "miss",
        aiInvoked: false,
        warnings: []
      }
    };
  }
}

class ExploreIsolationRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const workspacePath = input.aut.cwd;
    if (!workspacePath) {
      throw new Error("workspace path missing from AUT config");
    }

    const explorationMarkerPath = join(workspacePath, "explore-marker.txt");
    let inheritedExplorationState = false;
    try {
      await access(explorationMarkerPath);
      inheritedExplorationState = true;
    } catch {
      inheritedExplorationState = false;
    }

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success: !inheritedExplorationState,
      message: inheritedExplorationState ? "probe replay inherited exploration state" : "probe replay clean",
      latencyMs: 25,
      costUsd: 0.001,
      usageSummary: {
        latencyMs: 25,
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 15,
        costUsd: 0.001,
        resolvedCostUsd: 0.001,
        costSource: "exact",
        callCount: 1,
        unavailableCalls: 0
      },
      aiCalls: [],
      urlAfter: input.aut.url,
      trace: [
        {
          timestamp: nowIso(),
          action: "probe.check",
          details: {
            workspacePath,
            inheritedExplorationState
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "act_native",
        status: "miss",
        aiInvoked: false,
        warnings: []
      }
    };
  }

  async exploreTarget(input: {
    model: RunTaskInput["model"];
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: RunTaskInput["aut"];
    runConfig: RunTaskInput["runConfig"];
    cacheConfig: RunTaskInput["cacheConfig"];
    workspacePath: string;
  }): Promise<ExplorationArtifact> {
    await writeFile(join(input.workspacePath, "explore-marker.txt"), input.model.id, "utf8");

    return {
      explorationRunId: `explore-isolation-${input.trial}-${input.model.id.replace(/[^\w-]+/g, "_")}`,
      targetId: input.targetId,
      bugIds: input.bugIds,
      modelId: input.model.id,
      trial: input.trial,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      compatibility: {
        targetId: input.targetId,
        bugIds: input.bugIds,
        viewport: input.runConfig.viewport
      },
      history: [],
      pages: [],
      coverageGraph: {
        nodes: [],
        edges: []
      },
      observeCache: [],
      actionCache: [],
      cacheSummary: {
        statuses: {
          hit: 0,
          miss: 1,
          refreshed_after_failure: 0
        },
        modes: {
          act_native: 0,
          agent_native: 0,
          observe_manual: 1
        },
        aiInvokedRuns: 0,
        warningCount: 0
      },
      usageSummary: {
        latencyMs: 30,
        inputTokens: 12,
        outputTokens: 6,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 18,
        costUsd: 0.001,
        resolvedCostUsd: 0.001,
        costSource: "exact",
        callCount: 1,
        unavailableCalls: 0
      },
      aiCalls: [],
      trace: [],
      summary: {
        statesDiscovered: 1,
        transitionsDiscovered: 0,
        actionsCached: 0,
        observeCacheEntries: 0,
        historyEntries: 0
      }
    };
  }
}

describe("three experiment flows", () => {
  it(
    "runs the QA experiment and writes JSON plus HTML reports",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "qa-exp-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]);

      const result = await runQaExperiment({
        appId: "todo-react",
        profile: "full",
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new MockAutomationRunner(11)
      });

      expect(result.report.kind).toBe("qa");
      expect(result.report.leaderboard).toHaveLength(2);
      await expect(access(result.htmlPath)).resolves.toBeUndefined();
      const html = await readFile(result.htmlPath, "utf8");
      expect(html).toContain("Guided");
      expect(html).toContain("Task Pass");
      expect(html).toContain("Total Cost");
      const compare = await compareQaRuns([result.artifact.runId], dir);
      expect(compare.aggregateLeaderboard).toHaveLength(2);
      const compareHtml = await readFile(compare.finalReportPath, "utf8");
      expect(compareHtml).toContain("Guided Mode Comparison");
      expect(compareHtml).toContain("Guided Cost Audit");
    },
    15_000
  );

  it("emits progress logs while the QA experiment runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-logs-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);
    const logs: string[] = [];

    await runQaExperiment({
      appId: "todo-react",
      profile: "full",
      modelsPath,
      resultsDir: dir,
      trials: 1,
      runner: new MockAutomationRunner(11),
      onLog: (message) => logs.push(message)
    });

    expect(logs.some((message) => message.includes("[qa] Starting"))).toBe(true);
    expect(logs.some((message) => message.includes("guided task 1/"))).toBe(true);
    expect(logs.some((message) => message.includes("[qa] Completed"))).toBe(true);
  });

  it("defaults QA to the fast profile and writes incremental progress", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-fast-default-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, [
      "google/gemma-3-27b-it:free",
      "google/gemini-2.5-flash-lite"
    ]);

    const result = await runQaExperiment({
      appId: "todo-react",
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(11)
    });

    expect(result.artifact.spec.profile).toBe("fast");
    expect(result.artifact.spec.models).toEqual(["google/gemma-3-27b-it:free"]);
    expect(result.artifact.spec.trials).toBe(1);
    expect(result.artifact.spec.runtime.retryCount).toBe(0);
    expect(result.artifact.spec.runtime.maxSteps).toBe(8);
    expect(result.artifact.spec.runtime.timeoutMs).toBe(45_000);
    expect(result.artifact.spec.runtime.maxOutputTokens).toBe(300);

    const progressPath = join(dir, "qa", "runs", result.artifact.runId, "progress.json");
    const progress = JSON.parse(await readFile(progressPath, "utf8")) as {
      status: string;
      currentTaskId?: string;
      completedTasks: number;
      totalTasks: number;
    };
    expect(progress.status).toBe("completed");
    expect(progress.completedTasks).toBe(progress.totalTasks);
  });

  it("uses the enabled registry set for the full QA profile and excludes disabled free models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-full-profile-"));
    tempDirs.push(dir);
    const modelsPath = join(dir, "registry.yaml");
    await writeFile(
      modelsPath,
      [
        "default_model: mistralai/mistral-small-3.2-24b-instruct",
        "models:",
        "  - id: mistralai/mistral-small-3.2-24b-instruct",
        "    provider: mistralai",
        "    enabled: true",
        "  - id: qwen/qwen3.5-flash-02-23",
        "    provider: qwen",
        "    enabled: true",
        "  - id: openrouter/free",
        "    provider: openrouter",
        "    enabled: false"
      ].join("\n"),
      "utf8"
    );

    const result = await runQaExperiment({
      appId: "todo-react",
      profile: "full",
      modelsPath,
      resultsDir: dir,
      trials: 1,
      runner: new MockAutomationRunner(11)
    });

    expect(result.artifact.spec.profile).toBe("full");
    expect(result.artifact.spec.models).toEqual([
      "mistralai/mistral-small-3.2-24b-instruct",
      "qwen/qwen3.5-flash-02-23"
    ]);
    expect(result.report.modelSummaries.map((summary) => summary.model.id)).toEqual([
      "mistralai/mistral-small-3.2-24b-instruct",
      "qwen/qwen3.5-flash-02-23"
    ]);
    expect(result.artifact.spec.runtime.maxOutputTokens).toBe(600);
  });

  it("resets the QA workspace between models so model runs do not inherit prior state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-isolation-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]);

    const result = await runQaExperiment({
      appId: "todo-react",
      profile: "full",
      modelsPath,
      resultsDir: dir,
      trials: 1,
      runner: new WorkspaceIsolationRunner()
    });

    const taskRuns = result.report.modelSummaries.flatMap((summary) => summary.taskRuns);
    expect(taskRuns.length).toBeGreaterThan(0);
    expect(taskRuns.every((run) => run.success)).toBe(true);
    expect(taskRuns.some((run) => run.message === "fresh workspace")).toBe(true);
  });

  it(
    "resets explore state between exploration and probe replay",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "explore-isolation-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemma-3-27b-it:free", "minimax/minimax-m2.5:free"]);

      const result = await runExploreExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new ExploreIsolationRunner()
      });

      const probeRuns = result.report.modelSummaries.flatMap((summary) =>
        summary.trials.flatMap((trial) => trial.probeRuns.map((probeRun) => probeRun.taskRun))
      );
      expect(probeRuns.length).toBeGreaterThan(0);
      expect(probeRuns.every((run) => run.success)).toBe(true);
      expect(probeRuns.some((run) => run.message === "probe replay clean")).toBe(true);
    },
    15_000
  );

  it("runs the exploration experiment and scores coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explore-exp-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

    const result = await runExploreExperiment({
      appId: "todo-react",
      modelsPath,
      resultsDir: dir,
      runner: new RichExploreRunner()
    });

    expect(result.report.kind).toBe("explore");
    expect(result.report.leaderboard[0]?.capabilityDiscoveryRate).toBeGreaterThan(0);
    expect(result.report.leaderboard[0]?.actionDiversity).toBeGreaterThan(0);
    await expect(access(result.htmlPath)).resolves.toBeUndefined();
    const html = await readFile(result.htmlPath, "utf8");
    expect(html).toContain("Explore");
    expect(html).toContain("Capability Discovery");
  });

  it(
    "runs guided QA across all discoverable benchmark apps when no app is specified",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "qa-all-apps-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const result = await runQaAcrossApps({
        modelsPath,
        resultsDir: dir,
        trials: 1,
        profile: "full",
        runner: new MockAutomationRunner(11)
      });

      expect(result.mode).toBe("qa");
      expect(result.appIds).toEqual(["todo-angular", "todo-nextjs", "todo-react"]);
      expect(result.runs.map((run) => run.appId)).toEqual(result.appIds);
      expect(result.runs).toHaveLength(3);
      await expect(access(result.finalReportPath)).resolves.toBeUndefined();
      await expect(access(result.finalJsonPath)).resolves.toBeUndefined();
      const html = await readFile(result.finalReportPath, "utf8");
      expect(html).toContain("Guided Mode Comparison");
      expect(html).toContain("todo-angular");
      expect(html).toContain("todo-nextjs");
      expect(html).toContain("todo-react");
    },
    60_000
  );

  it(
    "runs exploration across all discoverable benchmark apps when no app is specified",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "explore-all-apps-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const result = await runExploreAcrossApps({
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new RichExploreRunner()
      });

      expect(result.mode).toBe("explore");
      expect(result.appIds).toEqual(["todo-angular", "todo-nextjs", "todo-react"]);
      expect(result.runs.map((run) => run.appId)).toEqual(result.appIds);
      expect(result.runs).toHaveLength(3);
      await expect(access(result.finalReportPath)).resolves.toBeUndefined();
      await expect(access(result.finalJsonPath)).resolves.toBeUndefined();
      const html = await readFile(result.finalReportPath, "utf8");
      expect(html).toContain("Explore Mode Comparison");
      expect(html).toContain("todo-angular");
      expect(html).toContain("todo-nextjs");
      expect(html).toContain("todo-react");
    },
    60_000
  );

  it(
    "runs the self-heal experiment end to end with integrated repair evaluation",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "heal-exp-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["openai/gpt-4o-mini"]);

      const result = await runHealExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        runner: new BugAwareRunner(),
        repairClient: new MockRepairModelClient()
      });

      expect(result.report.kind).toBe("heal");
      expect(result.report.modelSummaries[0]?.caseResults.some((item) => item.patchGenerated)).toBe(true);
      expect(result.report.modelSummaries[0]?.caseResults.some((item) => item.fixed)).toBe(true);
      await expect(access(result.htmlPath)).resolves.toBeUndefined();
      const html = await readFile(result.htmlPath, "utf8");
      expect(html).toContain("Self-Heal");
      expect(html).toContain("Failing-Task Fix");
      expect(html).toContain("Self-Heal Cost Audit");
    },
    60_000
  );

  it("does not render unavailable guided cost as a clean zero-cost result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-unavailable-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

    const result = await runQaExperiment({
      appId: "todo-react",
      profile: "full",
      modelsPath,
      resultsDir: dir,
      trials: 1,
      runner: new UnavailableCostRunner()
    });

    expect(result.report.leaderboard[0]?.costSummary.costSource).toBe("unavailable");
    expect(result.report.leaderboard[0]?.costSummary.unavailableCalls).toBeGreaterThan(0);
    const html = await readFile(result.htmlPath, "utf8");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("$0.0000</td>");
  });

  it(
    "runs self-heal across all discoverable benchmark apps when no app is specified",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "heal-all-apps-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["openai/gpt-4o-mini"]);

      const result = await runHealAcrossApps({
        modelsPath,
        resultsDir: dir,
        runner: new BugAwareRunner(),
        repairClient: createCrossFrameworkRepairClient()
      });

      expect(result.mode).toBe("heal");
      expect(result.appIds).toEqual(["todo-angular", "todo-nextjs", "todo-react"]);
      expect(result.runs.map((run) => run.appId)).toEqual(result.appIds);
      expect(result.runs).toHaveLength(3);
      await expect(access(result.finalReportPath)).resolves.toBeUndefined();
      await expect(access(result.finalJsonPath)).resolves.toBeUndefined();
      const html = await readFile(result.finalReportPath, "utf8");
      expect(html).toContain("Self-Heal Comparison");
      expect(html).toContain("todo-angular");
      expect(html).toContain("todo-nextjs");
      expect(html).toContain("todo-react");
    },
    120_000
  );

  it(
    "generates one combined final report for mixed qa, explore, and heal runs",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "final-compare-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const qa = await runQaExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new MockAutomationRunner(11)
      });
      const explore = await runExploreExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        runner: new RichExploreRunner()
      });
      const heal = await runHealExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        runner: new BugAwareRunner(),
        repairClient: new MockRepairModelClient()
      });

      const finalReport = await compareBenchmarkRuns(
        [qa.artifact.runId, explore.artifact.runId, heal.artifact.runId],
        dir
      );

      expect(finalReport.modeSections).toHaveLength(3);
      expect(finalReport.summaryFigures?.rankMatrix.columns.length).toBeGreaterThan(0);
      expect(finalReport.summaryFigures?.efficiencyFrontier.panels.map((panel) => panel.kind)).toEqual([
        "qa",
        "explore",
        "heal"
      ]);
      await expect(access(finalReport.finalReportPath)).resolves.toBeUndefined();
      await expect(access(finalReport.finalJsonPath)).resolves.toBeUndefined();
      const html = await readFile(finalReport.finalReportPath, "utf8");
      expect(html).toContain("Benchmark Final Report");
      expect(html).toContain("Cross-Benchmark Rank Matrix");
      expect(html).toContain("Efficiency Frontier by Mode");
      expect(html).toContain("Guided");
      expect(html).toContain("Explore");
      expect(html).toContain("Self-Heal");
      expect(html).toContain("todo-react");
    },
    60_000
  );

  it(
    "rebuilds the latest mode reports and benchmark mega report from saved benchmark report JSON files",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "latest-report-rebuild-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const qa = await runQaExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new MockAutomationRunner(11)
      });
      const explore = await runExploreExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        runner: new RichExploreRunner()
      });
      const heal = await runHealExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        runner: new BugAwareRunner(),
        repairClient: new MockRepairModelClient()
      });

      const rebuilt = await rebuildBenchmarkReports({
        resultsDir: dir
      });

      expect(rebuilt.selectionPolicy).toBe("latest-per-app-mode");
      expect(rebuilt.selectedReports.map((item) => item.runId).sort()).toEqual(
        [qa.artifact.runId, explore.artifact.runId, heal.artifact.runId].sort()
      );
      expect(rebuilt.modeReports.map((item) => item.kind)).toEqual(["qa", "explore", "heal"]);
      await expect(access(rebuilt.modeReports[0]!.finalReportPath)).resolves.toBeUndefined();
      await expect(access(rebuilt.finalReportPath!)).resolves.toBeUndefined();
      const html = await readFile(rebuilt.finalReportPath!, "utf8");
      const json = JSON.parse(await readFile(rebuilt.finalJsonPath!, "utf8")) as {
        summaryFigures?: {
          rankMatrix?: { rows: unknown[] };
          efficiencyFrontier?: { panels: unknown[] };
        };
      };
      expect(html).toContain("Benchmark Final Report");
      expect(html).toContain("Cross-Benchmark Rank Matrix");
      expect(html).toContain("latest-per-app-mode");
      expect(json.summaryFigures?.rankMatrix?.rows.length).toBeGreaterThan(0);
      expect(json.summaryFigures?.efficiencyFrontier?.panels.length).toBe(3);
    },
    60_000
  );

  it(
    "rebuilds only the requested mode when report rebuild is scoped to qa",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "latest-report-rebuild-qa-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const qa = await runQaExperiment({
        appId: "todo-react",
        modelsPath,
        resultsDir: dir,
        trials: 1,
        runner: new MockAutomationRunner(11)
      });

      const rebuilt = await rebuildBenchmarkReports({
        mode: "qa",
        resultsDir: dir
      });

      expect(rebuilt.selectedReports.map((item) => item.runId)).toEqual([qa.artifact.runId]);
      expect(rebuilt.modeReports).toHaveLength(1);
      expect(rebuilt.modeReports[0]?.kind).toBe("qa");
      expect(rebuilt.finalReportPath).toBeUndefined();
      expect(rebuilt.finalJsonPath).toBeUndefined();
      await expect(access(rebuilt.modeReports[0]!.finalReportPath)).resolves.toBeUndefined();
    },
    60_000
  );

  it(
    "runs a suite and returns the final matrix report paths",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "suite-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const result = await runBenchmarkSuite({
        suitePath: "apps/todo-react/benchmark.json",
        modelsPath,
        resultsDir: dir,
        qaRunner: new MockAutomationRunner(11),
        exploreRunner: new RichExploreRunner(),
        healRunner: new BugAwareRunner(),
        repairClient: new MockRepairModelClient()
      });

      expect(result.finalReportPath).toBeTruthy();
      expect(result.finalJsonPath).toBeTruthy();
      await expect(access(result.finalReportPath)).resolves.toBeUndefined();
      const html = await readFile(result.finalReportPath, "utf8");
      expect(html).toContain("Benchmark Final Report");
      expect(html).toContain("Self-Heal");
    },
    60_000
  );
});
