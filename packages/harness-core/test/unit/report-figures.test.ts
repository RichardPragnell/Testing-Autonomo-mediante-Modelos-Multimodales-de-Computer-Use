import { describe, expect, it } from "vitest";
import type { ExploreModelSummary, ExploreTrialArtifact, HealModelSummary, QaModelSummary } from "../../src/experiments/types.js";
import type { ModelAvailability, ScenarioRunResult } from "../../src/types.js";
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

function createScenarioRun(scenarioId: string, success: boolean, screenshotBase64 = "demo"): ScenarioRunResult {
  return {
    scenarioId,
    scenarioTitle: scenarioId,
    trial: 1,
    modelId: "test/model",
    success,
    message: success ? "passed" : "failed",
    latencyMs: 10,
    costUsd: 0.001,
    screenshotBase64,
    trace: [],
    stepRuns: []
  };
}

function createExploreTrial(
  trial: number,
  discovered: number,
  states: number,
  transitions: number,
  successfulProbeScenarioId = "add-task"
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
      matchedScenarioIds: [],
      matchedStepIds: [],
      matchedActionIds: []
    })),
    probeRuns: [
      {
        trial,
        scenarioId: successfulProbeScenarioId,
        success: true,
        matchedActionIds: [],
        scenarioRun: createScenarioRun(successfulProbeScenarioId, true)
      }
    ]
  };
}

describe("report figure selectors", () => {
  it("prefers edit-task for QA representative screenshots", () => {
    const summary: QaModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        capabilityPassRate: 1,
        scenarioCompletionRate: 1,
        stability: 1,
        stepPassRate: 1,
        avgLatencyMs: 10,
        avgCostUsd: 0.001,
        score: 90,
        executedScenarios: 5,
        skippedScenarios: 0
      },
      scenarioRuns: [
        createScenarioRun("add-task", true),
        createScenarioRun("edit-task", true),
        createScenarioRun("complete-task", true)
      ],
      capabilityRuns: []
    };

    expect(selectQaRepresentativeRun(summary)?.scenarioId).toBe("edit-task");
  });

  it("falls back to the first successful QA screenshot when preferred scenarios are absent", () => {
    const summary: QaModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        capabilityPassRate: 1,
        scenarioCompletionRate: 1,
        stability: 1,
        stepPassRate: 1,
        avgLatencyMs: 10,
        avgCostUsd: 0.001,
        score: 90,
        executedScenarios: 1,
        skippedScenarios: 0
      },
      scenarioRuns: [createScenarioRun("smoke-load", true)],
      capabilityRuns: []
    };

    expect(selectQaRepresentativeRun(summary)?.scenarioId).toBe("smoke-load");
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
        createExploreTrial(1, 1, 5, 5, "add-task"),
        createExploreTrial(2, 2, 4, 4, "edit-task"),
        createExploreTrial(3, 2, 3, 6, "complete-task")
      ]
    };

    expect(selectExploreBestTrial(summary)?.trial).toBe(2);
    expect(selectExploreRepresentativeProbeRun(summary)?.scenarioId).toBe("edit-task");
  });

  it("builds self-heal scorecards with overall and per-case badges", () => {
    const summary: HealModelSummary = {
      model: createModel("google/gemini-2.5-flash"),
      metrics: {
        modelId: "google/gemini-2.5-flash",
        localizationAccuracy: 1,
        patchApplyRate: 1,
        validationPassRate: 1,
        failingScenarioFixRate: 1,
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
          failingScenarioFixRate: 1,
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
          failingScenarioFixRate: 0,
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
