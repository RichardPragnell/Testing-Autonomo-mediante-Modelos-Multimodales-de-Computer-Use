import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceCandidates } from "../../src/diagnostics/source-candidates.js";
import { loadAppBenchmark } from "../../src/experiments/benchmark.js";
import { buildResolvedSuite } from "../../src/experiments/common.js";
import type { BenchmarkScenario, FailureCategory, ScenarioRunResult } from "../../src/types.js";

async function loadResolvedSuite(appId: string, scenarioIds: string[], bugIds: string[]) {
  const benchmark = await loadAppBenchmark(appId);
  return buildResolvedSuite({
    resolvedBenchmark: benchmark,
    scenarioIds,
    bugIds,
    explorationMode: "guided",
    suiteId: "source-candidates",
    resultsDir: "results",
    runtime: {
      timeoutMs: 5_000,
      retryCount: 0,
      maxSteps: 8,
      viewport: { width: 1200, height: 800 }
    },
    promptIds: {
      guided: benchmark.benchmark.prompts.guided
    }
  });
}

function createFailedScenarioRun(input: {
  scenario: BenchmarkScenario;
  message: string;
  error: string;
  traceInstruction: string;
  domSnapshot: string;
  urlAfter: string;
  category: FailureCategory;
}): ScenarioRunResult {
  const failedStep = input.scenario.steps.at(-1) ?? input.scenario.steps[0]!;
  const failedAssertion = failedStep.assertions.at(-1) ?? failedStep.assertions[0]!;

  return {
    scenarioId: input.scenario.scenarioId,
    scenarioTitle: input.scenario.title,
    trial: 1,
    modelId: "mock/model",
    success: false,
    message: input.message,
    latencyMs: 1000,
    costUsd: 0,
    urlAfter: input.urlAfter,
    domSnapshot: input.domSnapshot,
    trace: [
      {
        timestamp: "2026-03-08T00:00:00.000Z",
        action: "mock.act",
        details: { instruction: input.traceInstruction, category: input.category }
      }
    ],
    error: input.error,
    stepRuns: [
      {
        stepId: failedStep.stepId,
        title: failedStep.title,
        success: false,
        message: input.error,
        assertionRuns: [
          {
            assertionId: failedAssertion.assertionId,
            type: failedAssertion.type,
            success: false,
            message: input.error,
            error: input.error
          }
        ],
        urlAfter: input.urlAfter
      }
    ]
  };
}

describe("buildSourceCandidates", () => {
  it("prioritizes todo-store for the seeded add-task bug", async () => {
    const suite = await loadResolvedSuite("todo-react", ["add-task"], ["new-task-label-lost"]);
    const scenario = suite.selectedScenarios.find((item) => item.scenarioId === "add-task");
    expect(scenario).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-react-workspace"),
      suite,
      scenario: scenario!,
      result: createFailedScenarioRun({
        scenario: scenario!,
        message: "created todo label did not match input",
        error: "expected Review benchmark notes to be visible",
        traceInstruction: "type Review benchmark notes into the New task input",
        domSnapshot: "<html><body><span>New task</span></body></html>",
        urlAfter: "http://127.0.0.1:3101",
        category: "assertion"
      }),
      category: "assertion",
      message: "expected Review benchmark notes to be visible"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(candidates[0]?.reasons.join(" ")).toContain("new-task-label-lost");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "src/App.jsx")).toBe(true);
  });

  it("prioritizes todo-store and app rendering for completion failures", async () => {
    const suite = await loadResolvedSuite("todo-react", ["complete-task"], ["toggle-completion-noop"]);
    const scenario = suite.selectedScenarios.find((item) => item.scenarioId === "complete-task");
    expect(scenario).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-react-workspace"),
      suite,
      scenario: scenario!,
      result: createFailedScenarioRun({
        scenario: scenario!,
        message: "completion summary did not update",
        error: "expected 1 of 2 tasks done",
        traceInstruction: "click the checkbox for the task Draft Stagehand checklist",
        domSnapshot: "<html><body><strong>0 of 2 tasks done</strong></body></html>",
        urlAfter: "http://127.0.0.1:3101",
        category: "state"
      }),
      category: "state",
      message: "expected 1 of 2 tasks done"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(candidates[1]?.workspaceRelativePath).toBe("src/App.jsx");
    expect(candidates[0]?.reasons.join(" ")).toContain("toggle-completion-noop");
  });

  it("prioritizes edit handlers for edit failures", async () => {
    const suite = await loadResolvedSuite("todo-react", ["edit-task"], ["edit-task-save-noop"]);
    const scenario = suite.selectedScenarios.find((item) => item.scenarioId === "edit-task");
    expect(scenario).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-react-workspace"),
      suite,
      scenario: scenario!,
      result: createFailedScenarioRun({
        scenario: scenario!,
        message: "edited label did not update",
        error: "expected Plan todo benchmark outline",
        traceInstruction: "click the Save button",
        domSnapshot: "<html><body><span>Plan todo benchmark</span></body></html>",
        urlAfter: "http://127.0.0.1:3101",
        category: "state"
      }),
      category: "state",
      message: "expected Plan todo benchmark outline"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/todo-store.js");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "src/App.jsx")).toBe(true);
    expect(candidates[0]?.reasons.join(" ")).toContain("edit-task-save-noop");
  });

  it("uses Angular component and store paths for Angular failures", async () => {
    const suite = await loadResolvedSuite("todo-angular", ["complete-task"], ["toggle-completion-noop"]);
    const scenario = suite.selectedScenarios.find((item) => item.scenarioId === "complete-task");
    expect(scenario).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-angular-workspace"),
      suite,
      scenario: scenario!,
      result: createFailedScenarioRun({
        scenario: scenario!,
        message: "completion summary did not update",
        error: "expected 1 of 2 tasks done",
        traceInstruction: "click the checkbox for the task Draft Stagehand checklist",
        domSnapshot: "<html><body><strong>0 of 2 tasks done</strong></body></html>",
        urlAfter: "http://127.0.0.1:3103",
        category: "state"
      }),
      category: "state",
      message: "expected 1 of 2 tasks done"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("src/app/todo-store.ts");
    expect(candidates[1]?.workspaceRelativePath).toBe("src/app/app.component.ts");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "src/App.jsx")).toBe(false);
  });

  it("uses Next.js page and store paths for Next.js failures", async () => {
    const suite = await loadResolvedSuite("todo-nextjs", ["complete-task"], ["toggle-completion-noop"]);
    const scenario = suite.selectedScenarios.find((item) => item.scenarioId === "complete-task");
    expect(scenario).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "todo-nextjs-workspace"),
      suite,
      scenario: scenario!,
      result: createFailedScenarioRun({
        scenario: scenario!,
        message: "completion summary did not update",
        error: "expected 1 of 2 tasks done",
        traceInstruction: "click the checkbox for the task Draft Stagehand checklist",
        domSnapshot: "<html><body><strong>0 of 2 tasks done</strong></body></html>",
        urlAfter: "http://127.0.0.1:3102",
        category: "state"
      }),
      category: "state",
      message: "expected 1 of 2 tasks done"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("app/todo-store.js");
    expect(candidates[1]?.workspaceRelativePath).toBe("app/page.js");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "src/App.jsx")).toBe(false);
  });
});
