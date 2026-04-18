import type { ScenarioRunResult } from "../types.js";
import type {
  ExploreModelSummary,
  ExploreProbeRun,
  ExploreReport,
  ExploreTrialArtifact,
  HealModelSummary,
  HealReport,
  QaModelSummary,
  QaReport
} from "./types.js";

const QA_PREFERRED_SCENARIO_IDS = [
  "edit-task",
  "add-task",
  "complete-task",
  "filter-active",
  "create-delete-task"
];

const BASELINE_SCENARIO_IDS = ["smoke-load"];

function orderByLeaderboard<T extends { model: { id: string } }>(
  summaries: T[],
  leaderboard: Array<{ modelId: string }>
): T[] {
  const rankByModel = new Map(leaderboard.map((entry, index) => [entry.modelId, index]));
  return [...summaries].sort((left, right) => {
    const leftRank = rankByModel.get(left.model.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rankByModel.get(right.model.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function firstSuccessfulRun(
  scenarioRuns: ScenarioRunResult[],
  preferredScenarioIds: string[]
): ScenarioRunResult | undefined {
  for (const scenarioId of preferredScenarioIds) {
    const match = scenarioRuns.find((run) => run.success && run.scenarioId === scenarioId && run.screenshotBase64);
    if (match) {
      return match;
    }
  }

  return scenarioRuns.find((run) => run.success && run.screenshotBase64);
}

function firstRunWithScreenshot(scenarioRuns: ScenarioRunResult[]): ScenarioRunResult | undefined {
  return scenarioRuns.find((run) => run.screenshotBase64);
}

export function screenshotDataUrl(screenshotBase64?: string): string | undefined {
  if (!screenshotBase64) {
    return undefined;
  }
  return `data:image/png;base64,${screenshotBase64}`;
}

export function selectQaRepresentativeRun(summary: QaModelSummary): ScenarioRunResult | undefined {
  return firstSuccessfulRun(summary.scenarioRuns, QA_PREFERRED_SCENARIO_IDS);
}

export function selectQaBaselineRun(report: QaReport): ScenarioRunResult | undefined {
  for (const summary of orderByLeaderboard(report.modelSummaries, report.leaderboard)) {
    const match = firstSuccessfulRun(summary.scenarioRuns, BASELINE_SCENARIO_IDS);
    if (match) {
      return match;
    }
  }

  for (const summary of orderByLeaderboard(report.modelSummaries, report.leaderboard)) {
    const match = firstSuccessfulRun(summary.scenarioRuns, QA_PREFERRED_SCENARIO_IDS);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function discoveredCapabilityCount(trial: ExploreTrialArtifact): number {
  return trial.capabilityDiscovery.filter((item) => item.discovered).length;
}

function successfulProbeCount(trial: ExploreTrialArtifact): number {
  return trial.probeRuns.filter((item) => item.success).length;
}

export function selectExploreBestTrial(summary: ExploreModelSummary): ExploreTrialArtifact | undefined {
  return [...summary.trials].sort((left, right) => {
    return (
      discoveredCapabilityCount(right) - discoveredCapabilityCount(left) ||
      right.statesDiscovered - left.statesDiscovered ||
      right.transitionsDiscovered - left.transitionsDiscovered ||
      successfulProbeCount(right) - successfulProbeCount(left) ||
      left.trial - right.trial
    );
  })[0];
}

export function selectExploreRepresentativeProbeRun(summary: ExploreModelSummary): ExploreProbeRun | undefined {
  const bestTrial = selectExploreBestTrial(summary);
  if (!bestTrial) {
    return undefined;
  }

  const preferredSmoke = bestTrial.probeRuns.find(
    (probe) => probe.success && probe.scenarioId === "smoke-load" && probe.scenarioRun.screenshotBase64
  );
  if (preferredSmoke) {
    return preferredSmoke;
  }

  return bestTrial.probeRuns.find((probe) => probe.success && probe.scenarioRun.screenshotBase64);
}

export function selectExploreBaselineRun(report: ExploreReport): ScenarioRunResult | undefined {
  for (const summary of orderByLeaderboard(report.modelSummaries, report.leaderboard)) {
    for (const trial of [...summary.trials].sort((left, right) => left.trial - right.trial)) {
      for (const scenarioId of BASELINE_SCENARIO_IDS) {
        const match = trial.probeRuns.find(
          (probe) => probe.success && probe.scenarioId === scenarioId && probe.scenarioRun.screenshotBase64
        );
        if (match) {
          return match.scenarioRun;
        }
      }
    }
  }

  for (const summary of orderByLeaderboard(report.modelSummaries, report.leaderboard)) {
    const match = selectExploreRepresentativeProbeRun(summary);
    if (match) {
      return match.scenarioRun;
    }
  }

  return undefined;
}

export function selectHealBaselineRun(report: HealReport): ScenarioRunResult | undefined {
  for (const summary of orderByLeaderboard(report.modelSummaries, report.leaderboard)) {
    for (const caseResult of summary.caseResults) {
      const reproduction = firstRunWithScreenshot(caseResult.reproductionRuns);
      if (reproduction) {
        return reproduction;
      }
      const regression = firstRunWithScreenshot(caseResult.postPatchRegressionRuns);
      if (regression) {
        return regression;
      }
      const postPatch = firstRunWithScreenshot(caseResult.postPatchReproductionRuns);
      if (postPatch) {
        return postPatch;
      }
    }
  }

  return undefined;
}

export interface HealModelScorecard {
  badges: string[];
  caseBadges: string[];
}

export function buildHealModelScorecard(summary: HealModelSummary): HealModelScorecard {
  const fixedCases = summary.caseResults.filter((item) => item.fixed).length;
  const caseBadges = summary.caseResults.map((item) => {
    const status = item.fixed ? "Fixed" : item.validationPassed ? "Validated" : item.patchApplied ? "Patched" : "Failed";
    return `${item.title}: ${status}`;
  });

  return {
    badges: [
      `Fixed ${fixedCases}/${summary.caseResults.length || 0}`,
      `Localization ${(summary.metrics.localizationAccuracy * 100).toFixed(1)}%`,
      `Validation ${(summary.metrics.validationPassRate * 100).toFixed(1)}%`
    ],
    caseBadges
  };
}
