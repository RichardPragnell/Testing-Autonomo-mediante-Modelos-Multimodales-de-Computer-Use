import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBenchmarkSuite } from "../../src/config/suite.js";
import { buildSourceCandidates } from "../../src/diagnostics/source-candidates.js";

describe("buildSourceCandidates", () => {
  it("prioritizes todo-store for the seeded add-task bug", async () => {
    const suite = await loadBenchmarkSuite({
      suite: {
        suiteId: "source-candidates-add-task",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["new-task-label-lost"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 1,
        resultsDir: "results"
      }
    });

    const task = suite.tasks.find((item) => item.id === "guided-add-task");
    expect(task).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-react-workspace"),
      suite,
      task: task!,
      result: {
        taskId: "guided-add-task",
        trial: 1,
        modelId: "mock/model",
        success: false,
        message: "created todo label did not match input",
        latencyMs: 1000,
        costUsd: 0,
        urlAfter: "http://127.0.0.1:3101",
        domSnapshot: "<html><body><span>New task</span></body></html>",
        trace: [
          {
            timestamp: "2026-03-08T00:00:00.000Z",
            action: "mock.goto",
            details: { url: "http://127.0.0.1:3101" }
          }
        ],
        error: "expected Review benchmark notes to be visible"
      },
      category: "assertion",
      message: "expected Review benchmark notes to be visible"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(candidates[0]?.reasons.join(" ")).toContain("new-task-label-lost");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "src/App.jsx")).toBe(true);
  });

  it("prioritizes todo-store and app rendering for completion failures", async () => {
    const suite = await loadBenchmarkSuite({
      suite: {
        suiteId: "source-candidates-complete-task",
        targetId: "todo-react",
        scenarioIds: ["guided"],
        bugIds: ["toggle-completion-noop"],
        explorationMode: "guided",
        trials: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        maxSteps: 8,
        viewport: { width: 1200, height: 800 },
        seed: 1,
        resultsDir: "results"
      }
    });

    const task = suite.tasks.find((item) => item.id === "guided-complete-task");
    expect(task).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-react-workspace"),
      suite,
      task: task!,
      result: {
        taskId: "guided-complete-task",
        trial: 1,
        modelId: "mock/model",
        success: false,
        message: "completion summary did not update",
        latencyMs: 1000,
        costUsd: 0,
        urlAfter: "http://127.0.0.1:3101",
        domSnapshot: "<html><body><strong>0 of 2 tasks done</strong></body></html>",
        trace: [
          {
            timestamp: "2026-03-08T00:00:00.000Z",
            action: "mock.act",
            details: { instruction: task!.instruction }
          }
        ],
        error: "expected 1 of 2 tasks done"
      },
      category: "state",
      message: "expected 1 of 2 tasks done"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(candidates[1]?.workspaceRelativePath).toBe("src/App.jsx");
    expect(candidates[0]?.reasons.join(" ")).toContain("toggle-completion-noop");
  });
});
