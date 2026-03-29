import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareBenchmarkRuns,
  compareQaRuns,
  runBenchmarkSuite,
  runExploreExperiment,
  runHealExperiment,
  runQaExperiment
} from "../../src/index.js";
import { MockAutomationRunner } from "../../src/runner/mock-runner.js";
import { MockRepairModelClient } from "../../src/self-heal/model-client.js";
import { nowIso } from "../../src/utils/time.js";
import type { AutomationRunner, ExplorationArtifact, RunTaskInput, TaskRunResult } from "../../src/types.js";

const tempDirs: string[] = [];
const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test-ai-gateway-key";
});

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await removeDirWithRetries(dir);
    }
  }

  if (originalGatewayKey === undefined) {
    delete process.env.AI_GATEWAY_API_KEY;
  } else {
    process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
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
          lookupStatus: "resolved",
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
          lookupStatus: "resolved",
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
          lookupStatus: "resolved",
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
    const store = (await readFile(join(cwd, "src", "todo-store.js"), "utf8")).replaceAll("\r\n", "\n");
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
          lookupStatus: "resolved",
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
          lookupStatus: "lookup_failed",
          costSource: "unavailable",
          latencyMs: 75,
          inputTokens: 180,
          outputTokens: 40,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 220,
          timestamp: nowIso(),
          error: "lookup failed"
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

describe("three experiment flows", () => {
  it("runs the QA experiment and writes JSON plus HTML reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-exp-"));
    tempDirs.push(dir);
    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]);

    const result = await runQaExperiment({
      appId: "todo-react",
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
  });

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
      await expect(access(finalReport.finalReportPath)).resolves.toBeUndefined();
      await expect(access(finalReport.finalJsonPath)).resolves.toBeUndefined();
      const html = await readFile(finalReport.finalReportPath, "utf8");
      expect(html).toContain("Benchmark Final Report");
      expect(html).toContain("Guided");
      expect(html).toContain("Explore");
      expect(html).toContain("Self-Heal");
      expect(html).toContain("todo-react");
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
