import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { compareQaRuns, runExploreExperiment, runHealExperiment, runQaExperiment } from "../../src/index.js";
import { MockAutomationRunner } from "../../src/runner/mock-runner.js";
import { MockRepairModelClient } from "../../src/self-heal/model-client.js";
import { nowIso } from "../../src/utils/time.js";
import type { AutomationRunner, ExplorationArtifact, RunTaskInput, TaskRunResult } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await removeDirWithRetries(dir);
    }
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
    const success = input.task.id.startsWith("smoke") || (input.cacheHints?.length ?? 0) > 0;
    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success,
      message: success ? "probe replay succeeded" : "probe replay failed",
      latencyMs: 120,
      costUsd: 0.003,
      urlAfter: input.aut.url,
      trace: [
        {
          timestamp: nowIso(),
          action: "rich.probe",
          details: {
            taskId: input.task.id,
            cacheHints: input.cacheHints?.map((entry) => entry.actionId) ?? []
          }
        }
      ],
      cacheHints: input.cacheHints
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
    workspacePath: string;
  }): Promise<ExplorationArtifact> {
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
      trace: [],
      summary: {
        statesDiscovered: 4,
        transitionsDiscovered: 3,
        actionsCached: 5,
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

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success,
      message: success ? "task passed" : "task failed",
      latencyMs: 90,
      costUsd: 0.002,
      urlAfter: input.aut.url,
      domSnapshot: success ? "<html><body><h1>ok</h1></body></html>" : "<html><body><h1>Mismatch</h1></body></html>",
      trace: [
        {
          timestamp: nowIso(),
          action: "bug-aware.run",
          details: {
            taskId: input.task.id
          }
        }
      ],
      error: success ? undefined : "expected app behavior not observed"
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
    const compare = await compareQaRuns([result.artifact.runId], dir);
    expect(compare.aggregateLeaderboard).toHaveLength(2);
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
    },
    20_000
  );
});
