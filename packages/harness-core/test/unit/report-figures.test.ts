import { describe, expect, it } from "vitest";
import type { ExploreModelSummary, ExploreTrialArtifact, HealModelSummary, QaModelSummary } from "../../src/experiments/types.js";
import type { ModelAvailability, TaskRunResult } from "../../src/types.js";
import {
  buildHealModelScorecard,
  selectExploreBestTrial,
  selectExploreRepresentativeProbeRun,
  selectQaRepresentativeRun
} from "../../src/experiments/report-figures.js";

function createModel(id: string): ModelAvailability {
  return {
    id,
    provider: id.split("/")[0] ?? "test",
    enabled: true,
    available: true
  };
}

function createTaskRun(taskId: string, success: boolean, screenshotBase64 = "demo"): TaskRunResult {
  return {
    taskId,
    trial: 1,
    modelId: "test/model",
    success,
    message: success ? "passed" : "failed",
    latencyMs: 10,
    costUsd: 0.001,
    screenshotBase64,
    trace: []
  };
}

function createExploreTrial(
  trial: number,
  discovered: number,
  states: number,
  transitions: number,
  successfulProbeTaskId = "guided-add-task"
): ExploreTrialArtifact {
  return {
    trial,
    explorationRunId: `trial-${trial}`,
    statesDiscovered: states,
    transitionsDiscovered: transitions,
    actionsCached: 1,
    actionKinds: ["add"],
    capabilityDiscovery: Array.from({ length: 3 }, (_, index) => ({
      capabilityId: `cap-${index}`,
      title: `Capability ${index}`,
      trial,
      discovered: index < discovered,
      matchedActionIds: []
    })),
    probeRuns: [
      {
        trial,
        taskId: successfulProbeTaskId,
        success: true,
        matchedActionIds: [],
        taskRun: createTaskRun(successfulProbeTaskId, true)
      }
    ]
  };
}

describe("report figure selectors", () => {
  it("prefers guided-edit-task for QA representative screenshots", () => {
    const summary: QaModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        capabilityPassRate: 1,
        fullScenarioCompletionRate: 1,
        stability: 1,
        taskPassRate: 1,
        avgLatencyMs: 10,
        avgCostUsd: 0.001,
        score: 90,
        executedTasks: 5,
        skippedTasks: 0
      },
      taskRuns: [
        createTaskRun("guided-add-task", true),
        createTaskRun("guided-edit-task", true),
        createTaskRun("guided-complete-task", true)
      ],
      capabilityRuns: []
    };

    expect(selectQaRepresentativeRun(summary)?.taskId).toBe("guided-edit-task");
  });

  it("falls back to the first successful QA screenshot when preferred tasks are absent", () => {
    const summary: QaModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        capabilityPassRate: 1,
        fullScenarioCompletionRate: 1,
        stability: 1,
        taskPassRate: 1,
        avgLatencyMs: 10,
        avgCostUsd: 0.001,
        score: 90,
        executedTasks: 2,
        skippedTasks: 0
      },
      taskRuns: [createTaskRun("smoke-home-title", true), createTaskRun("smoke-default-count", true)],
      capabilityRuns: []
    };

    expect(selectQaRepresentativeRun(summary)?.taskId).toBe("smoke-home-title");
  });

  it("selects the exploration best trial by discovery, then states, then transitions", () => {
    const summary: ExploreModelSummary = {
      model: createModel("google/gemini-2.5-pro"),
      metrics: {
        modelId: "google/gemini-2.5-pro",
        capabilityDiscoveryRate: 1,
        probeReplayPassRate: 1,
        stateCoverage: 1,
        transitionCoverage: 1,
        actionDiversity: 1,
        avgLatencyMs: 10,
        avgCostUsd: 0.001,
        score: 99
      },
      trials: [
        createExploreTrial(1, 1, 5, 5, "guided-add-task"),
        createExploreTrial(2, 2, 4, 4, "guided-edit-task"),
        createExploreTrial(3, 2, 3, 6, "guided-complete-task")
      ]
    };

    expect(selectExploreBestTrial(summary)?.trial).toBe(2);
    expect(selectExploreRepresentativeProbeRun(summary)?.taskId).toBe("guided-edit-task");
  });

  it("builds self-heal scorecards with overall and per-case badges", () => {
    const summary: HealModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        localizationAccuracy: 1,
        patchApplyRate: 1,
        validationPassRate: 1,
        failingTaskFixRate: 1,
        regressionFreeRate: 1,
        fixRate: 1,
        avgLatencyMs: 100,
        avgCostUsd: 0.1,
        score: 91.132
      },
      cacheSummary: undefined,
      caseResults: [
        {
          caseId: "case-a",
          title: "Repair created task labels",
          trial: 1,
          reproductionRuns: [],
          findings: [],
          suspectedFiles: [],
          goldTouchedFiles: [],
          patchGenerated: true,
          patchApplied: true,
          validationPassed: true,
          failingTaskFixRate: 1,
          regressionFreeRate: 1,
          localizationScore: 1,
          fixed: true,
          repairUsage: {
            latencyMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 2,
            costUsd: 0.01,
            resolvedCostUsd: 0.01,
            costSource: "exact",
            callCount: 1,
            unavailableCalls: 0
          },
          note: "fixed",
          postPatchReproductionRuns: [],
          postPatchRegressionRuns: []
        },
        {
          caseId: "case-b",
          title: "Repair completion toggling",
          trial: 1,
          reproductionRuns: [],
          findings: [],
          suspectedFiles: [],
          goldTouchedFiles: [],
          patchGenerated: true,
          patchApplied: true,
          validationPassed: false,
          failingTaskFixRate: 0,
          regressionFreeRate: 0,
          localizationScore: 1,
          fixed: false,
          repairUsage: {
            latencyMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 2,
            costUsd: 0.01,
            resolvedCostUsd: 0.01,
            costSource: "exact",
            callCount: 1,
            unavailableCalls: 0
          },
          note: "failed validation",
          postPatchReproductionRuns: [],
          postPatchRegressionRuns: []
        }
      ]
    };

    const scorecard = buildHealModelScorecard(summary);

    expect(scorecard.badges).toContain("Fixed 1/2");
    expect(scorecard.caseBadges).toContain("Repair created task labels: Fixed");
    expect(scorecard.caseBadges).toContain("Repair completion toggling: Patched");
  });
});
