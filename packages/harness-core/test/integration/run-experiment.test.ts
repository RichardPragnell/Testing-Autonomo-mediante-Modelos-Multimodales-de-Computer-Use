import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadBenchmarkSuite } from "../../src/config/suite.js";
import { prepareRunWorkspace } from "../../src/runtime/workspace.js";
import { MockAutomationRunner } from "../../src/runner/mock-runner.js";
import { applyPatchInIsolatedWorktree } from "../../src/self-heal/worktree.js";
import { exploreTarget, runBenchmarkSuite, runGuided } from "../../src/service.js";
import type { AutomationRunner, RunTaskInput, TaskRunResult } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

class SelectiveFailureRunner implements AutomationRunner {
  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const failingTask = input.task.id === "guided-complete-task";
    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success: !failingTask,
      message: failingTask ? "completion summary mismatch" : "ok",
      latencyMs: 100,
      costUsd: 0,
      urlAfter: "http://127.0.0.1:3101",
      domSnapshot: failingTask
        ? "<html><body><strong>0 of 2 tasks done</strong></body></html>"
        : "<html><body><h1>ok</h1></body></html>",
      trace: [
        {
          timestamp: "2026-03-08T00:00:00.000Z",
          action: "mock.act",
          details: { instruction: input.task.instruction }
        }
      ],
      error: failingTask ? "assert expected 1 of 2 tasks done" : undefined
    };
  }
}

async function writeRegistry(dir: string, models: string[] = ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]) {
  const modelsPath = join(dir, "registry.yaml");
  const lines = ["default_model: google/gemini-2.5-flash", "models:"];
  for (const modelId of models) {
    lines.push(`  - id: ${modelId}`);
    lines.push(`    provider: ${modelId.split("/")[0]}`);
    lines.push("    enabled: true");
  }
  await writeFile(modelsPath, lines.join("\n"), "utf8");
  return modelsPath;
}

describe("benchmark suite integration", () => {
  it("clones the pristine target into a run workspace and applies selected bug packs", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "bench-workspace-"));
    tempDirs.push(resultsRoot);

    const resolvedSuite = await loadBenchmarkSuite({
      suite: {
        suiteId: "workspace-prepare",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["new-task-label-lost", "toggle-completion-noop"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 7,
        resultsDir: resultsRoot
      }
    });

    const workspace = await prepareRunWorkspace({
      resolvedSuite,
      runId: "workspace-001",
      resultsRoot
    });

    const templateStore = await readFile(join(resolvedSuite.target.templatePath, "src", "todo-store.js"), "utf8");
    const workspaceStore = await readFile(join(workspace.workspacePath, "src", "todo-store.js"), "utf8");

    expect(templateStore).toContain("text: text.trim()");
    expect(templateStore).toContain("done: !todo.done");
    expect(workspaceStore).toContain('text: "New task"');
    expect(workspaceStore).toContain("return todos;");
    await expect(access(join(workspace.workspacePath, ".git"))).resolves.toBeUndefined();
  });

  it("resolves repo-root placeholders for framework-based targets cloned into a run workspace", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "bench-react-workspace-"));
    tempDirs.push(resultsRoot);

    const resolvedSuite = await loadBenchmarkSuite({
      suite: {
        suiteId: "todo-react-prepare",
        targetId: "todo-react",
        scenarioIds: ["smoke"],
        bugIds: [],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 13,
        resultsDir: resultsRoot
      }
    });

    const workspace = await prepareRunWorkspace({
      resolvedSuite,
      runId: "todo-react-workspace-001",
      resultsRoot
    });

    expect(workspace.aut.command).toContain("node_modules/vite/bin/vite.js");
    expect(workspace.aut.command).not.toContain("{{repoRoot}}");
    expect(workspace.validationCommand).toBe("node --test tests/*.test.mjs");
    await expect(access(join(workspace.workspacePath, "vite.config.js"))).resolves.toBeUndefined();
  });

  it("applies todo-react bug packs on top of the pristine React template", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "bench-react-bugs-"));
    tempDirs.push(resultsRoot);

    const resolvedSuite = await loadBenchmarkSuite({
      suite: {
        suiteId: "todo-react-bugs",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["new-task-label-lost", "toggle-completion-noop"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 17,
        resultsDir: resultsRoot
      }
    });

    const workspace = await prepareRunWorkspace({
      resolvedSuite,
      runId: "todo-react-bugs-001",
      resultsRoot
    });

    const templateStore = await readFile(join(resolvedSuite.target.templatePath, "src", "todo-store.js"), "utf8");
    const workspaceStore = await readFile(join(workspace.workspacePath, "src", "todo-store.js"), "utf8");

    expect(templateStore).toContain("text: text.trim()");
    expect(templateStore).toContain("done: !todo.done");
    expect(workspaceStore).toContain('text: "New task"');
    expect(workspaceStore).toContain("return todos;");
  });

  it(
    "runs a benchmark suite and persists artifacts under results",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "bench-run-"));
      tempDirs.push(dir);

      const modelsPath = join(dir, "registry.yaml");
      await writeFile(
        modelsPath,
        [
          "default_model: google/gemini-2.5-flash",
          "models:",
          "  - id: google/gemini-2.5-flash",
          "    provider: google",
          "    enabled: true",
          "  - id: openai/gpt-4o-mini",
          "    provider: openai",
          "    enabled: true"
        ].join("\n"),
        "utf8"
      );

      const result = await runBenchmarkSuite({
        modelsPath,
        runner: new MockAutomationRunner(11),
        suite: {
          suiteId: "integration-suite",
          targetId: "todo-react",
          scenarioIds: ["smoke", "guided"],
          bugIds: ["new-task-label-lost", "toggle-completion-noop"],
          models: ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
          explorationMode: "guided",
          promptIds: {
            guided: "guided.default",
            repair: "repair.default"
          },
          trials: 2,
          timeoutMs: 10_000,
          retryCount: 0,
          maxSteps: 10,
          viewport: { width: 1280, height: 720 },
          seed: 11,
          resultsDir: dir
        }
      });

      expect(result.artifact.targetId).toBe("todo-react");
      expect(result.artifact.scenarioIds).toEqual(["smoke", "guided"]);
      expect(result.artifact.bugIds).toEqual(["new-task-label-lost", "toggle-completion-noop"]);
      expect(result.report.suiteId).toBe("integration-suite");
      expect(result.report.targetId).toBe("todo-react");

      const artifactRaw = await readFile(result.artifactPath, "utf8");
      const reportRaw = await readFile(result.reportPath, "utf8");
      expect(artifactRaw).toContain("\"workspacePath\"");
      expect(reportRaw).toContain("\"explorationMode\": \"guided\"");
    },
    20_000
  );

  it(
    "runs autonomous exploration before evaluating scenarios and persists exploration artifacts",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "bench-autonomous-"));
      tempDirs.push(dir);

      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);
      const result = await runBenchmarkSuite({
        modelsPath,
        runner: new MockAutomationRunner(19),
        suite: {
          suiteId: "integration-autonomous-suite",
          targetId: "todo-react",
          scenarioIds: ["smoke", "guided"],
          bugIds: ["new-task-label-lost", "toggle-completion-noop", "edit-task-save-noop"],
          models: ["google/gemini-2.5-flash"],
          explorationMode: "autonomous",
          promptIds: {
            guided: "guided.default",
            autonomous: "autonomous.default",
            repair: "repair.default"
          },
          trials: 1,
          timeoutMs: 10_000,
          retryCount: 0,
          maxSteps: 10,
          viewport: { width: 1280, height: 720 },
          seed: 23,
          resultsDir: dir
        }
      });

      expect(result.artifact.autonomousExploration).toHaveLength(1);
      expect(result.report.autonomousExploration).toHaveLength(1);
      await expect(
        access(
          join(
            dir,
            "runs",
            result.artifact.runId,
            "exploration",
            "google/gemini-2.5-flash",
            "trial_1",
            "graph.json"
          )
        )
      ).resolves.toBeUndefined();
      await expect(
        access(
          join(
            dir,
            "runs",
            result.artifact.runId,
            "exploration",
            "google/gemini-2.5-flash",
            "trial_1",
            "action-cache.json"
          )
        )
      ).resolves.toBeUndefined();
    },
    20_000
  );

  it("persists standalone exploration artifacts under results/explorations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-explore-"));
    tempDirs.push(dir);

    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);
    const result = await exploreTarget({
      targetId: "todo-react",
      modelId: "google/gemini-2.5-flash",
      bugIds: ["toggle-completion-noop"],
      prompt: "Explore the todo app and discover edit or filter actions.",
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(29)
    });

    expect(result.artifact.summary.actionsCached).toBeGreaterThan(0);
    await expect(
      access(join(dir, "explorations", result.artifact.explorationRunId, "exploration.json"))
    ).resolves.toBeUndefined();
    await expect(
      access(join(dir, "explorations", result.artifact.explorationRunId, "history.json"))
    ).resolves.toBeUndefined();
  });

  it("reuses a compatible exploration cache for guided runtime execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-guided-cache-"));
    tempDirs.push(dir);

    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);
    const exploration = await exploreTarget({
      targetId: "todo-react",
      modelId: "google/gemini-2.5-flash",
      bugIds: [],
      prompt: "Edit an existing todo item",
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(31)
    });

    const result = await runGuided({
      targetId: "todo-react",
      modelId: "google/gemini-2.5-flash",
      scenarioIds: ["guided"],
      bugIds: [],
      explorationRunId: exploration.artifact.explorationRunId,
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(31)
    });

    expect(result.artifact.guidedCacheUsage?.compatible).toBe(true);
    expect(result.artifact.guidedCacheUsage?.matchedActions).toBeGreaterThan(0);
    const editRun = result.artifact.modelSummaries[0]?.taskRuns.find((task) => task.taskId === "guided-edit-task");
    expect(editRun?.cacheHints?.length).toBeGreaterThan(0);
  });

  it("records cache mismatches when a guided runtime run reuses an incompatible exploration artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-guided-mismatch-"));
    tempDirs.push(dir);

    const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);
    const exploration = await exploreTarget({
      targetId: "todo-react",
      modelId: "google/gemini-2.5-flash",
      bugIds: ["toggle-completion-noop"],
      prompt: "Edit an existing todo item",
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(37)
    });

    const result = await runGuided({
      targetId: "todo-react",
      modelId: "google/gemini-2.5-flash",
      scenarioIds: ["guided"],
      bugIds: [],
      explorationRunId: exploration.artifact.explorationRunId,
      modelsPath,
      resultsDir: dir,
      runner: new MockAutomationRunner(37)
    });

    expect(result.artifact.guidedCacheUsage?.compatible).toBe(false);
    expect(result.artifact.guidedCacheUsage?.reason).toContain("bug mismatch");
    expect(result.artifact.modelSummaries[0]?.taskRuns[0]?.trace[0]?.action).toBe("cache.mismatch");
  });

  it("persists ranked source candidates for failed tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-findings-"));
    tempDirs.push(dir);

    const modelsPath = join(dir, "registry.yaml");
    await writeFile(
      modelsPath,
      [
        "default_model: openai/gpt-4o-mini",
        "models:",
        "  - id: openai/gpt-4o-mini",
        "    provider: openai",
        "    enabled: true"
      ].join("\n"),
      "utf8"
    );

    const result = await runBenchmarkSuite({
      modelsPath,
      runner: new SelectiveFailureRunner(),
      suite: {
        suiteId: "finding-source-candidates",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["toggle-completion-noop"],
        models: ["openai/gpt-4o-mini"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 10_000,
        retryCount: 0,
        maxSteps: 10,
        viewport: { width: 1280, height: 720 },
        seed: 5,
        resultsDir: dir
      }
    });

    expect(result.artifact.findings).toHaveLength(1);
    expect(result.artifact.findings[0]?.sourceCandidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(result.artifact.findings[0]?.sourceCandidates[0]?.reasons.join(" ")).toContain("toggle-completion-noop");

    const artifactRaw = await readFile(result.artifactPath, "utf8");
    expect(artifactRaw).toContain("\"sourceCandidates\"");
    expect(artifactRaw).toContain("src/todo-store.js");
  });

  it("keeps self-heal validation isolated to the cloned workspace repo", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "bench-heal-"));
    tempDirs.push(resultsRoot);

    const resolvedSuite = await loadBenchmarkSuite({
      suite: {
        suiteId: "heal-isolation",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["toggle-completion-noop"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 21,
        resultsDir: resultsRoot
      }
    });

    const workspace = await prepareRunWorkspace({
      resolvedSuite,
      runId: "heal-001",
      resultsRoot
    });

    const patch = [
      "--- a/src/todo-store.js",
      "+++ b/src/todo-store.js",
      "@@ -19,7 +19,7 @@ export function addTodo(todos, text) {",
      " }",
      " ",
      " export function toggleTodo(todos, id) {",
      "-  return todos;",
      "+  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));",
      " }",
      " ",
      " export function updateTodoText(todos, id, text) {"
    ].join("\n") + "\n";

    const result = await applyPatchInIsolatedWorktree({
      cwd: workspace.workspacePath,
      patch,
      validationCommand: workspace.validationCommand,
      attemptId: "heal-attempt"
    });

    const workspaceStore = await readFile(join(workspace.workspacePath, "src", "todo-store.js"), "utf8");
    const templateStore = await readFile(join(resolvedSuite.target.templatePath, "src", "todo-store.js"), "utf8");

    expect(result.outcome).toBe("fixed");
    expect(workspaceStore).toContain("return todos;");
    expect(templateStore).toContain("done: !todo.done");
  });
});
