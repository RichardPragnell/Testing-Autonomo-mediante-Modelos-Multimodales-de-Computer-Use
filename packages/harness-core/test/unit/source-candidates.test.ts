import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBenchmarkSuite } from "../../src/config/suite.js";
import { buildSourceCandidates } from "../../src/diagnostics/source-candidates.js";

describe("buildSourceCandidates", () => {
  it("prioritizes incident domain files for the seeded critical-filter bug", async () => {
    const suite = await loadBenchmarkSuite({
      suite: {
        suiteId: "source-candidates-incidents",
        targetId: "pulse-lab",
        scenarioIds: ["guided"],
        bugIds: ["critical-filter-empty"],
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

    const task = suite.tasks.find((item) => item.id === "guided-critical-filter");
    expect(task).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "pulse-lab-workspace"),
      suite,
      task: task!,
      result: {
        taskId: "guided-critical-filter",
        trial: 1,
        modelId: "mock/model",
        success: false,
        message: "critical summary mismatch",
        latencyMs: 1000,
        costUsd: 0,
        urlAfter: "http://127.0.0.1:3000/#incidents",
        domSnapshot: "<html><body><p class='incident-summary'>0 critical incidents</p></body></html>",
        trace: [
          {
            timestamp: "2026-03-08T00:00:00.000Z",
            action: "mock.goto",
            details: { url: "http://127.0.0.1:3000/#incidents" }
          }
        ],
        error: "assert expected 2 critical incidents"
      },
      category: "state",
      message: "assert expected 2 critical incidents"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("public/modules/domain/incidents.js");
    expect(candidates[0]?.reasons.join(" ")).toContain("critical-filter-empty");
    expect(candidates.some((candidate) => candidate.workspaceRelativePath === "public/modules/ui/render.js")).toBe(true);
  });

  it("prioritizes preferences state and toast rendering for settings feedback failures", async () => {
    const suite = await loadBenchmarkSuite({
      suite: {
        suiteId: "source-candidates-settings",
        targetId: "pulse-lab",
        scenarioIds: ["guided"],
        bugIds: ["preferences-toast-hidden"],
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

    const task = suite.tasks.find((item) => item.id === "guided-save-preferences");
    expect(task).toBeDefined();

    const candidates = buildSourceCandidates({
      workspacePath: join("C:", "bench", "pulse-lab-workspace"),
      suite,
      task: task!,
      result: {
        taskId: "guided-save-preferences",
        trial: 1,
        modelId: "mock/model",
        success: false,
        message: "toast not visible",
        latencyMs: 1000,
        costUsd: 0,
        urlAfter: "http://127.0.0.1:3000/#settings",
        domSnapshot: "<html><body><form id='preferences-form'></form><div id='toast-region'></div></body></html>",
        trace: [
          {
            timestamp: "2026-03-08T00:00:00.000Z",
            action: "mock.act",
            details: { instruction: task!.instruction }
          }
        ],
        error: "Preferences saved confirmation was not visible"
      },
      category: "unexpected_ui",
      message: "Preferences saved confirmation was not visible"
    });

    expect(candidates[0]?.workspaceRelativePath).toBe("public/modules/state/preferences.js");
    expect(candidates[1]?.workspaceRelativePath).toBe("public/modules/ui/render.js");
    expect(candidates[0]?.reasons.join(" ")).toContain("preferences-toast-hidden");
  });
});
