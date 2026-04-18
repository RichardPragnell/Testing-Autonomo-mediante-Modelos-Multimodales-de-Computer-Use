import type { ScenarioRunResult } from "../types.js";
import type {
  BenchmarkComparisonRow,
  ExploreModelSummary,
  HealCaseTrialResult,
  HealModelSummary,
  QaModelSummary
} from "./types.js";

const INFRASTRUCTURE_FAILURE_PATTERNS = [
  /OpenRouter request timed out/i,
  /timed out after \d+ms/i,
  /Failed to process successful response/i,
  /Upstream error/i,
  /Provider returned error/i,
  /No endpoints available/i,
  /guardrail restrictions|data policy/i,
  /rate limit|too many requests|429/i,
  /service unavailable|gateway timeout|bad gateway|connection closed/i,
  /Type validation failed: Value:\s*\{"error"/i
];

function hasInfrastructureFailureText(value: string | undefined): boolean {
  return Boolean(value && INFRASTRUCTURE_FAILURE_PATTERNS.some((pattern) => pattern.test(value)));
}

function scenarioRunFailureText(run: ScenarioRunResult): string {
  const stepText = run.stepRuns
    .flatMap((step) => [
      step.message,
      ...step.assertionRuns.flatMap((assertion) => [assertion.message, assertion.error])
    ])
    .filter(Boolean)
    .join("\n");
  return [run.message, run.error, stepText].filter(Boolean).join("\n");
}

function isInfrastructureScenarioRun(run: ScenarioRunResult): boolean {
  return !run.success && hasInfrastructureFailureText(scenarioRunFailureText(run));
}

export function isReportableQaModelSummary(summary: QaModelSummary): boolean {
  return (
    summary.model.available &&
    summary.scenarioRuns.length > 0 &&
    !summary.scenarioRuns.every(isInfrastructureScenarioRun)
  );
}

export function isReportableExploreModelSummary(summary: ExploreModelSummary): boolean {
  if (!summary.model.available || summary.trials.length === 0) {
    return false;
  }

  const explorationEvidence = summary.trials.some(
    (trial) => trial.statesDiscovered > 0 || trial.transitionsDiscovered > 0 || trial.actionsCached > 0
  );
  const probeRuns = summary.trials.flatMap((trial) => trial.probeRuns.map((probeRun) => probeRun.scenarioRun));
  return explorationEvidence || probeRuns.some((run) => !isInfrastructureScenarioRun(run));
}

function isInfrastructureHealCase(caseResult: HealCaseTrialResult): boolean {
  if (hasInfrastructureFailureText(caseResult.note)) {
    return true;
  }
  const reproductionRuns = caseResult.reproductionRuns ?? [];
  return reproductionRuns.length > 0 && reproductionRuns.every(isInfrastructureScenarioRun);
}

function hasHealExecutionEvidence(caseResult: HealCaseTrialResult): boolean {
  return (
    (caseResult.reproductionRuns?.length ?? 0) > 0 ||
    (caseResult.findings?.length ?? 0) > 0 ||
    caseResult.patchGenerated ||
    caseResult.patchApplied ||
    typeof caseResult.validationExitCode === "number" ||
    (caseResult.repairUsage?.callCount ?? 0) > 0 ||
    (caseResult.postPatchReproductionRuns?.length ?? 0) > 0 ||
    (caseResult.postPatchRegressionRuns?.length ?? 0) > 0
  );
}

function hasHealMetricEvidence(summary: HealModelSummary): boolean {
  return (
    numericMetric(summary.metrics.score) > 0 ||
    numericMetric(summary.metrics.fixRate) > 0 ||
    numericMetric(summary.metrics.failingScenarioFixRate) > 0 ||
    numericMetric(summary.metrics.regressionFreeRate) > 0 ||
    numericMetric(summary.metrics.validationPassRate) > 0 ||
    numericMetric(summary.metrics.localizationAccuracy) > 0 ||
    numericMetric(summary.metrics.patchApplyRate) > 0 ||
    numericMetric(summary.metrics.avgCostUsd) > 0
  );
}

export function isReportableHealModelSummary(summary: HealModelSummary): boolean {
  return (
    summary.model.available &&
    summary.caseResults.length > 0 &&
    !summary.caseResults.every(isInfrastructureHealCase) &&
    (hasHealMetricEvidence(summary) ||
      summary.caseResults.some((caseResult) => hasHealExecutionEvidence(caseResult) && !isInfrastructureHealCase(caseResult)))
  );
}

export function isReusableHealModelSummary(summary: HealModelSummary): boolean {
  return isReportableHealModelSummary(summary);
}

function numericMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isReportableComparisonRow(row: BenchmarkComparisonRow): boolean {
  return row.cells.some((cell) => {
    if (cell.costSummary.callCount <= 0 && cell.costSummary.totalResolvedUsd <= 0) {
      return false;
    }

    if ("fixRate" in cell.metrics || "failingScenarioFix" in cell.metrics) {
      return true;
    }

    return Object.entries(cell.metrics).some(([key, value]) => {
      if (["score", "stability", "avgLatency", "avgCost", "totalCost"].includes(key)) {
        return false;
      }
      return typeof value === "number" && value > 0;
    }) || numericMetric(cell.metrics.score) > 0;
  });
}
