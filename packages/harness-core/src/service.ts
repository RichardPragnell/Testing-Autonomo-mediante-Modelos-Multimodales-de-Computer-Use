import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { describeBenchmarkTarget, listBenchmarkTargets } from "./config/target.js";
import { loadProjectEnv } from "./env/load.js";
import { loadAppBenchmark } from "./experiments/benchmark.js";
import { persistComparisonReport } from "./experiments/comparison.js";
import {
  isReportableComparisonRow,
  isReportableExploreModelSummary,
  isReportableHealModelSummary,
  isReportableQaModelSummary,
  isReusableHealModelSummary
} from "./experiments/reportability.js";
import {
  renderBenchmarkComparisonHtml,
  renderBenchmarkFinalComparisonHtml,
  renderBenchmarkStandardizedComparisonHtml
} from "./experiments/report-matrix.js";
import {
  buildResolvedSuite,
  emitExperimentLog,
  executeGuidedScenarios,
  formatDurationMs,
  mapWithConcurrency,
  resolveExperimentRoot,
  resolveParallelism,
  readCandidateFileSnippets
} from "./experiments/common.js";
import {
  buildExploreComparison,
  clearExploreOutputs,
  compareExploreRuns,
  getExploreReport,
  runExploreExperiment,
  type RunExploreExperimentInput
} from "./experiments/explore.js";
import {
  buildHealComparison,
  buildHealReport,
  clearHealOutputs,
  compareHealRuns,
  getHealReport,
  runHealExperiment,
  type RunHealExperimentInput
} from "./experiments/heal.js";
import {
  buildQaComparison,
  clearQaOutputs,
  compareQaRuns,
  getQaReport,
  runQaExperiment,
  type RunQaExperimentInput
} from "./experiments/qa.js";
import type {
  AppBenchmarkManifest,
  BenchmarkSelectionPolicy,
  BenchmarkComparisonProvenance,
  BenchmarkComparisonProvenanceEntry,
  BenchmarkComparisonRow,
  BenchmarkComparisonSection,
  BenchmarkComparisonReport,
  CompareResult,
  ExperimentKind,
  ExperimentLogFn,
  ExploreReport,
  ExploreRunArtifact,
  ExploreSavedReport,
  ExploreModelSummary,
  ExploreRunResult,
  HealReport,
  HealRunArtifact,
  HealSavedReport,
  HealModelSummary,
  HealRunResult,
  QaModelSummary,
  QaReport,
  QaRunArtifact,
  QaRunResult,
  QaSavedReport
} from "./experiments/types.js";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "./cache/config.js";
import { summarizeScenarioRunCache } from "./cache/summary.js";
import { resolveExplorationCompatibility } from "./exploration/action-cache.js";
import { persistRunExplorationArtifacts } from "./persistence/store.js";
import { StagehandAutomationRunner } from "./runner/stagehand-runner.js";
import { startAut } from "./runtime/aut.js";
import { prepareRunWorkspace } from "./runtime/workspace.js";
import { runAgentForPatch } from "./self-heal/adapter.js";
import type { RepairModelClient } from "./self-heal/model-client.js";
import { applyPatchInIsolatedWorktree } from "./self-heal/worktree.js";
import type {
  AutomationRunner,
  ExplorationArtifact,
  ExplorationCacheUsage,
  Finding,
  ExecutionCacheConfig,
  ModelAvailability,
  ScenarioRunResult,
  StagehandRunConfig,
} from "./types.js";
import { ensureDir, readText, resolveWorkspacePath, writeJson, writeText } from "./utils/fs.js";
import { nowIso } from "./utils/time.js";

type BenchmarkRunKind = "qa" | "explore" | "heal";
type BenchmarkReport = QaReport | ExploreReport | HealReport;
type SavedBenchmarkReport = QaSavedReport | ExploreSavedReport | HealSavedReport;

interface RuntimeGuidedRunRecord {
  kind: "guided";
  runId: string;
  targetId: string;
  modelId: string;
  scenarioIds: string[];
  bugIds: string[];
  promptId: string;
  runtime: StagehandRunConfig;
  cacheConfig: ExecutionCacheConfig;
  startedAt: string;
  finishedAt: string;
  workspacePath: string;
  validationCommand: string;
  explorationCacheUsage?: ExplorationCacheUsage;
  cacheSummary?: ReturnType<typeof summarizeScenarioRunCache>;
  scenarioRuns: ScenarioRunResult[];
  findings: Finding[];
}

interface RuntimeExploreRunRecord {
  kind: "runtime-explore";
  runId: string;
  targetId: string;
  modelId: string;
  bugIds: string[];
  prompt: string;
  runtime: StagehandRunConfig;
  cacheConfig: ExecutionCacheConfig;
  startedAt: string;
  finishedAt: string;
  workspacePath: string;
  explorationRunId: string;
  artifactPath: string;
  cacheSummary?: ReturnType<typeof summarizeScenarioRunCache>;
  summary: ExplorationArtifact["summary"];
}

interface RuntimeHealRunRecord {
  kind: "runtime-heal";
  runId: string;
  sourceRunId: string;
  findingId: string;
  targetId: string;
  workspacePath: string;
  validationCommand: string;
  agentCommand: string;
  createdAt: string;
  patchPath?: string;
  agent: {
    exitCode: number;
    stdoutPath: string;
    stderrPath: string;
  };
  repair: {
    outcome: "fixed" | "not_fixed" | "regression" | "skipped";
    note: string;
    patchPath?: string;
    validationExitCode?: number;
  };
}

export interface BenchmarkSuiteDescriptor {
  appId: string;
  displayName: string;
  suitePath: string;
  targetId: string;
  prompts: AppBenchmarkManifest["prompts"];
  runtime: AppBenchmarkManifest["runtime"];
}

export interface RunBenchmarkSuiteInput {
  suitePath: string;
  modelsPath?: string;
  resultsDir?: string;
  qaRunner?: AutomationRunner;
  exploreRunner?: AutomationRunner;
  healRunner?: AutomationRunner;
  repairClient?: RepairModelClient;
  onLog?: ExperimentLogFn;
}

export interface RunQaAcrossAppsInput extends Omit<RunQaExperimentInput, "appId"> {
  appsRoot?: string;
  appParallelism?: number;
  skipExisting?: boolean;
  cleanupFailedArtifacts?: boolean;
}

export interface RunExploreAcrossAppsInput extends Omit<RunExploreExperimentInput, "appId"> {
  appsRoot?: string;
  appParallelism?: number;
  skipExisting?: boolean;
  cleanupFailedArtifacts?: boolean;
}

export interface RunHealAcrossAppsInput extends Omit<RunHealExperimentInput, "appId"> {
  appsRoot?: string;
  appParallelism?: number;
  skipExisting?: boolean;
  cleanupFailedArtifacts?: boolean;
}

export interface MultiAppExperimentRunEntry {
  appId: string;
  runId: string;
  artifactPath: string;
  reportPath: string;
  htmlPath: string;
}

export interface MultiAppExperimentRunResult {
  mode: ExperimentKind;
  appIds: string[];
  runs: MultiAppExperimentRunEntry[];
  finalReportPath: string;
  finalJsonPath: string;
}

export interface RunQaAcrossAppsResult extends MultiAppExperimentRunResult {
  mode: "qa";
  comparison: CompareResult<QaReport>;
}

export interface RunExploreAcrossAppsResult extends MultiAppExperimentRunResult {
  mode: "explore";
  comparison: CompareResult<ExploreReport>;
}

export interface RunHealAcrossAppsResult extends MultiAppExperimentRunResult {
  mode: "heal";
  comparison: CompareResult<HealReport>;
}

export interface RebuiltBenchmarkReportSelection {
  kind: ExperimentKind;
  appId: string;
  modelId: string;
  runId: string;
  generatedAt: string;
  reportPath: string;
}

export interface RebuiltModeReport {
  kind: ExperimentKind;
  appIds: string[];
  runIds: string[];
  finalReportPath: string;
  finalJsonPath: string;
}

export interface RebuildBenchmarkReportsInput {
  mode?: ExperimentKind;
  resultsDir?: string;
  htmlScope?: "compare" | "all";
}

export interface RebuildBenchmarkReportsResult {
  selectionPolicy: BenchmarkSelectionPolicy;
  selectedReports: RebuiltBenchmarkReportSelection[];
  modeReports: RebuiltModeReport[];
  finalReportPath?: string;
  finalJsonPath?: string;
}

export interface ExploreTargetInput {
  targetId: string;
  modelId?: string;
  bugIds?: string[];
  prompt: string;
  modelsPath?: string;
  resultsDir?: string;
  timeoutMs?: number;
  retryCount?: number;
  maxSteps?: number;
  viewport?: {
    width: number;
    height: number;
  };
  runner?: AutomationRunner;
}

export interface RunGuidedInput {
  targetId: string;
  scenarioIds: string[];
  modelId?: string;
  bugIds?: string[];
  modelsPath?: string;
  resultsDir?: string;
  guidedPromptId?: string;
  explorationRunId?: string;
  timeoutMs?: number;
  retryCount?: number;
  maxSteps?: number;
  viewport?: {
    width: number;
    height: number;
  };
  runner?: AutomationRunner;
}

export interface RunSelfHealInput {
  runId: string;
  findingId: string;
  agentCommand: string;
  validationCommand?: string;
  resultsDir?: string;
}

function benchmarkRunKind(runId: string): BenchmarkRunKind | undefined {
  if (runId.startsWith("guided-")) {
    return "qa";
  }
  if (runId.startsWith("qa-")) {
    return "qa";
  }
  if (runId.startsWith("explore-")) {
    return "explore";
  }
  if (runId.startsWith("heal-")) {
    return "heal";
  }
  return undefined;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function resolveRuntimeRoot(
  resultsDir: string,
  kind: RuntimeGuidedRunRecord["kind"] | RuntimeExploreRunRecord["kind"] | RuntimeHealRunRecord["kind"]
): Promise<string> {
  return join(await resolveWorkspacePath(resultsDir), kind);
}

function summarizeScenarioRuns(scenarioRuns: ScenarioRunResult[]) {
  return {
    total: scenarioRuns.length,
    passed: scenarioRuns.filter((scenarioRun) => scenarioRun.success).length,
    failed: scenarioRuns.filter((scenarioRun) => !scenarioRun.success).length,
    cacheSummary: summarizeScenarioRunCache(scenarioRuns)
  };
}

function resolveRuntimeConfig(
  manifest: AppBenchmarkManifest,
  overrides: {
    timeoutMs?: number;
    retryCount?: number;
    maxSteps?: number;
    viewport?: {
      width: number;
      height: number;
    };
  }
): StagehandRunConfig {
  return {
    timeoutMs: overrides.timeoutMs ?? manifest.runtime.timeoutMs,
    retryCount: overrides.retryCount ?? manifest.runtime.retryCount,
    maxSteps: overrides.maxSteps ?? manifest.runtime.maxSteps,
    viewport: overrides.viewport ?? manifest.runtime.viewport
  };
}

async function resolveSingleModel(modelId?: string, modelsPath?: string): Promise<ModelAvailability> {
  const registryPath = await resolveWorkspacePath(modelsPath ?? "experiments/models/registry.yaml");
  const registry = await loadModelRegistry(registryPath);
  const candidates = resolveModelAvailability(registry, modelId ? [modelId] : undefined);
  const preferred =
    (modelId ? candidates.find((candidate) => candidate.id === modelId) : undefined) ??
    candidates.find((candidate) => candidate.available) ??
    candidates[0];

  if (!preferred) {
    throw new Error(
      modelId ? `model ${modelId} is not declared in ${registryPath}` : `no enabled models configured in ${registryPath}`
    );
  }
  if (!preferred.available) {
    throw new Error(preferred.reason ?? `model ${preferred.id} is not available`);
  }
  return preferred;
}

async function resolveSuiteManifest(pathLike: string): Promise<{
  appId: string;
  suitePath: string;
}> {
  const suitePath = await resolveWorkspacePath(pathLike);
  const manifest = JSON.parse(await readText(suitePath)) as { appId?: unknown };
  const appId =
    typeof manifest.appId === "string" && manifest.appId.trim().length > 0
      ? manifest.appId
      : basename(dirname(suitePath));

  return {
    appId,
    suitePath
  };
}

async function locateExplorationArtifactInRuns(
  runsRoot: string,
  explorationRunId: string
): Promise<
  | {
      artifact: ExplorationArtifact;
      artifactPath: string;
      runId: string;
    }
  | undefined
> {
  let runEntries;
  try {
    runEntries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory()) {
      continue;
    }

    const explorationRoot = join(runsRoot, runEntry.name, "exploration");
    let modelEntries;
    try {
      modelEntries = await readdir(explorationRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const modelEntry of modelEntries) {
      if (!modelEntry.isDirectory()) {
        continue;
      }

      const trialsRoot = join(explorationRoot, modelEntry.name);
      let trialEntries;
      try {
        trialEntries = await readdir(trialsRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const trialEntry of trialEntries) {
        if (!trialEntry.isDirectory()) {
          continue;
        }

        const artifactPath = join(trialsRoot, trialEntry.name, "exploration.json");
        try {
          const artifact = await readJsonFile<ExplorationArtifact>(artifactPath);
          if (artifact.explorationRunId === explorationRunId) {
            return {
              artifact,
              artifactPath,
              runId: runEntry.name
            };
          }
        } catch {
          continue;
        }
      }
    }
  }

  return undefined;
}

async function findExplorationArtifact(
  explorationRunId: string,
  resultsDir = "results"
): Promise<
  | {
      artifact: ExplorationArtifact;
      artifactPath: string;
      runId: string;
    }
  | undefined
> {
  const resultsRoot = await resolveWorkspacePath(resultsDir);
  const roots = [join(resultsRoot, "runtime-explore", "runs"), join(resultsRoot, "explore", "runs")];

  for (const root of roots) {
    const found = await locateExplorationArtifactInRuns(root, explorationRunId);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function compareByKind(
  kind: BenchmarkRunKind,
  reports: Array<{ section: BenchmarkComparisonSection }>
): Pick<CompareResult<BenchmarkReport>, "aggregateLeaderboard" | "modeSection"> {
  if (kind === "qa") {
    return buildQaComparison(reports as QaSavedReport[]);
  }
  if (kind === "explore") {
    return buildExploreComparison(reports as ExploreSavedReport[]);
  }
  return buildHealComparison(reports as HealSavedReport[]);
}

async function getBenchmarkReportByKind(
  kind: BenchmarkRunKind,
  runId: string,
  resultsDir: string
): Promise<BenchmarkReport> {
  if (kind === "qa") {
    return getQaReport(runId, resultsDir);
  }
  if (kind === "explore") {
    return getExploreReport(runId, resultsDir);
  }
  return getHealReport(runId, resultsDir);
}

function comparisonConfig(kind: BenchmarkRunKind): {
  title: string;
  subtitleNoun: string;
  prefix: string;
} {
  if (kind === "qa") {
    return {
      title: "Guided Mode Comparison",
      subtitleNoun: "guided",
      prefix: "guided-compare"
    };
  }
  if (kind === "explore") {
    return {
      title: "Explore Mode Comparison",
      subtitleNoun: "exploration",
      prefix: "explore-compare"
    };
  }
  return {
    title: "Self-Heal Comparison",
    subtitleNoun: "self-heal",
    prefix: "heal-compare"
  };
}

async function persistLatestComparisonReport(input: {
  title: string;
  subtitle: string;
  runIds: string[];
  modeSections: BenchmarkComparisonReport["modeSections"];
  resultsDir: string;
  prefix: string;
  provenance?: BenchmarkComparisonProvenance;
  htmlVariant?: "mode" | "benchmark-final";
}): Promise<BenchmarkComparisonReport> {
  return persistComparisonReport({
    title: input.title,
    subtitle: input.subtitle,
    runIds: input.runIds,
    modeSections: input.modeSections,
    resultsDir: input.resultsDir,
    prefix: input.prefix,
    stableName: `${input.prefix}-latest`,
    provenance: input.provenance,
    htmlVariant: input.htmlVariant
  });
}

function reportTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortSelections<T extends {
  kind: ExperimentKind;
  appId: string;
  modelId: string;
  runId: string;
}>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    return (
      left.kind.localeCompare(right.kind) ||
      left.appId.localeCompare(right.appId) ||
      left.modelId.localeCompare(right.modelId) ||
      left.runId.localeCompare(right.runId)
    );
  });
}

type ExistingQaModelSummary = {
  kind: "qa";
  appId: string;
  modelId: string;
  sourceRunId: string;
  timestamp: number;
  summary: QaModelSummary;
};

type ExistingExploreModelSummary = {
  kind: "explore";
  appId: string;
  modelId: string;
  sourceRunId: string;
  timestamp: number;
  summary: ExploreModelSummary;
};

type ExistingHealModelSummary = {
  kind: "heal";
  appId: string;
  modelId: string;
  sourceRunId: string;
  timestamp: number;
  summary: HealModelSummary;
};

type ExistingModelSummary = ExistingQaModelSummary | ExistingExploreModelSummary | ExistingHealModelSummary;

function modelSummaryKey(appId: string, modelId: string): string {
  return `${appId}::${modelId}`;
}

function hasReusableQaData(summary: QaModelSummary): boolean {
  return isReportableQaModelSummary(summary);
}

function hasReusableExploreData(summary: ExploreModelSummary): boolean {
  return isReportableExploreModelSummary(summary);
}

function hasReusableHealData(summary: HealModelSummary): boolean {
  return isReusableHealModelSummary(summary);
}

function keepLatestExistingSummary<T extends ExistingModelSummary>(latest: Map<string, T>, candidate: T): void {
  const key = modelSummaryKey(candidate.appId, candidate.modelId);
  const current = latest.get(key);
  if (
    !current ||
    candidate.timestamp > current.timestamp ||
    (candidate.timestamp === current.timestamp && candidate.sourceRunId.localeCompare(current.sourceRunId) > 0)
  ) {
    latest.set(key, candidate);
  }
}

export interface PruneNonReportableBenchmarkArtifactsResult {
  kind: ExperimentKind;
  runCount: number;
  prunedRunCount: number;
  removedModelSummaries: number;
  removedArtifactPaths: number;
}

function safePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "artifact";
}

function assertPathInside(parent: string, target: string): void {
  const resolvedParent = resolve(parent);
  const resolvedTarget = resolve(target);
  const pathToTarget = relative(resolvedParent, resolvedTarget);
  if (pathToTarget === "" || pathToTarget.startsWith("..") || isAbsolute(pathToTarget)) {
    throw new Error(`refusing to remove path outside ${resolvedParent}: ${resolvedTarget}`);
  }
}

async function removeDirectoryInside(parent: string, target: string): Promise<boolean> {
  assertPathInside(parent, target);
  try {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  return true;
}

function qaModelId(summary: QaModelSummary): string {
  return summary.metrics.modelId || summary.model.id;
}

function exploreModelId(summary: ExploreModelSummary): string {
  return summary.metrics.modelId || summary.model.id;
}

function healModelId(summary: HealModelSummary): string {
  return summary.metrics.modelId || summary.model.id;
}

async function removeTopLevelModelArtifacts(runDir: string, modelId: string): Promise<number> {
  const safeModelId = safePathSegment(modelId);
  let removed = 0;
  for (const artifactKind of ["artifacts", "exploration"]) {
    if (await removeDirectoryInside(runDir, join(runDir, artifactKind, safeModelId))) {
      removed += 1;
    }
  }
  return removed;
}

async function removeHealAttemptArtifacts(runsRoot: string, runId: string, removedModelIndexes: number[]): Promise<number> {
  if (!removedModelIndexes.length) {
    return 0;
  }

  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return 0;
  }

  const removedIndexes = new Set(removedModelIndexes.map((index) => String(index + 1)));
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${runId}-`)) {
      continue;
    }

    const match = entry.name.match(/-model-(\d+)(?:$|-)/);
    if (!match || !removedIndexes.has(match[1])) {
      continue;
    }

    if (await removeDirectoryInside(runsRoot, join(runsRoot, entry.name))) {
      removed += 1;
    }
  }
  return removed;
}

async function rewriteSavedReportWithoutModels(input: {
  reportsDir: string;
  runId: string;
  removedModelIds: string[];
}): Promise<void> {
  const reportPath = join(input.reportsDir, `${input.runId}.json`);
  let savedReport: SavedBenchmarkReport;
  try {
    savedReport = await readJsonFile<SavedBenchmarkReport>(reportPath);
  } catch {
    return;
  }

  const removed = new Set(input.removedModelIds);
  savedReport = {
    ...savedReport,
    section: {
      ...savedReport.section,
      rows: savedReport.section.rows.filter((row) => !removed.has(row.modelId)),
      audit: {
        ...savedReport.section.audit,
        rows: savedReport.section.audit.rows.filter((row) => !row.some((cell) => removed.has(cell)))
      }
    }
  };

  await writeJson(reportPath, savedReport);
  await writeText(
    join(input.reportsDir, `${input.runId}.html`),
    renderBenchmarkComparisonHtml(toSingleRunComparisonReport(savedReport, reportPath))
  );
}

async function pruneQaRun(input: {
  artifact: QaRunArtifact;
  artifactPath: string;
  reportsDir: string;
}): Promise<{ removedModelIds: string[]; removedArtifactPaths: number }> {
  const removed = input.artifact.modelSummaries
    .map((summary, index) => ({ summary, index, modelId: qaModelId(summary) }))
    .filter((entry) => !isReportableQaModelSummary(entry.summary));
  if (!removed.length) {
    return { removedModelIds: [], removedArtifactPaths: 0 };
  }

  input.artifact.modelSummaries = input.artifact.modelSummaries.filter(isReportableQaModelSummary);
  await writeJson(input.artifactPath, input.artifact);

  const runDir = dirname(input.artifactPath);
  let removedArtifactPaths = 0;
  for (const entry of removed) {
    removedArtifactPaths += await removeTopLevelModelArtifacts(runDir, entry.modelId);
  }
  await rewriteSavedReportWithoutModels({
    reportsDir: input.reportsDir,
    runId: input.artifact.runId,
    removedModelIds: removed.map((entry) => entry.modelId)
  });

  return {
    removedModelIds: removed.map((entry) => entry.modelId),
    removedArtifactPaths
  };
}

async function pruneExploreRun(input: {
  artifact: ExploreRunArtifact;
  artifactPath: string;
  reportsDir: string;
}): Promise<{ removedModelIds: string[]; removedArtifactPaths: number }> {
  const removed = input.artifact.modelSummaries
    .map((summary, index) => ({ summary, index, modelId: exploreModelId(summary) }))
    .filter((entry) => !isReportableExploreModelSummary(entry.summary));
  if (!removed.length) {
    return { removedModelIds: [], removedArtifactPaths: 0 };
  }

  input.artifact.modelSummaries = input.artifact.modelSummaries.filter(isReportableExploreModelSummary);
  await writeJson(input.artifactPath, input.artifact);

  const runDir = dirname(input.artifactPath);
  let removedArtifactPaths = 0;
  for (const entry of removed) {
    removedArtifactPaths += await removeTopLevelModelArtifacts(runDir, entry.modelId);
  }
  await rewriteSavedReportWithoutModels({
    reportsDir: input.reportsDir,
    runId: input.artifact.runId,
    removedModelIds: removed.map((entry) => entry.modelId)
  });

  return {
    removedModelIds: removed.map((entry) => entry.modelId),
    removedArtifactPaths
  };
}

async function pruneHealRun(input: {
  artifact: HealRunArtifact;
  artifactPath: string;
  reportsDir: string;
  runsRoot: string;
}): Promise<{ removedModelIds: string[]; removedArtifactPaths: number }> {
  const summaries = input.artifact.modelSummaries.map((summary, index) => ({
    summary,
    index,
    modelId: healModelId(summary)
  }));
  const removed = summaries
    .filter((entry) => !isReusableHealModelSummary(entry.summary));
  const hiddenFromReport = summaries
    .filter((entry) => !isReportableHealModelSummary(entry.summary))
    .map((entry) => entry.modelId);

  if (hiddenFromReport.length) {
    await rewriteSavedReportWithoutModels({
      reportsDir: input.reportsDir,
      runId: input.artifact.runId,
      removedModelIds: hiddenFromReport
    });
  }

  if (!removed.length) {
    return { removedModelIds: [], removedArtifactPaths: 0 };
  }

  input.artifact.modelSummaries = input.artifact.modelSummaries.filter(isReusableHealModelSummary);
  await writeJson(input.artifactPath, input.artifact);

  const runDir = dirname(input.artifactPath);
  let removedArtifactPaths = 0;
  for (const entry of removed) {
    removedArtifactPaths += await removeTopLevelModelArtifacts(runDir, entry.modelId);
  }
  removedArtifactPaths += await removeHealAttemptArtifacts(
    input.runsRoot,
    input.artifact.runId,
    removed.map((entry) => entry.index)
  );

  return {
    removedModelIds: removed.map((entry) => entry.modelId),
    removedArtifactPaths
  };
}

export async function pruneNonReportableBenchmarkArtifacts(
  kind: BenchmarkRunKind,
  resultsDir = "results",
  onLog?: ExperimentLogFn
): Promise<PruneNonReportableBenchmarkArtifactsResult> {
  const root = await resolveExperimentRoot(resultsDir, kind);
  const runsRoot = join(root, "runs");
  const reportsDir = join(root, "reports");
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return { kind, runCount: 0, prunedRunCount: 0, removedModelSummaries: 0, removedArtifactPaths: 0 };
  }

  const result: PruneNonReportableBenchmarkArtifactsResult = {
    kind,
    runCount: 0,
    prunedRunCount: 0,
    removedModelSummaries: 0,
    removedArtifactPaths: 0
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const artifactPath = join(runsRoot, entry.name, "run.json");
    try {
      if (kind === "qa") {
        const artifact = await readJsonFile<QaRunArtifact>(artifactPath);
        if (artifact.kind !== "qa") {
          continue;
        }
        result.runCount += 1;
        const pruned = await pruneQaRun({ artifact, artifactPath, reportsDir });
        if (pruned.removedModelIds.length) {
          result.prunedRunCount += 1;
          result.removedModelSummaries += pruned.removedModelIds.length;
          result.removedArtifactPaths += pruned.removedArtifactPaths;
          emitExperimentLog(
            onLog,
            `[${kind}] Removed non-reportable model data from ${artifact.runId}: ${pruned.removedModelIds.join(", ")}`
          );
        }
        continue;
      }

      if (kind === "explore") {
        const artifact = await readJsonFile<ExploreRunArtifact>(artifactPath);
        if (artifact.kind !== "explore") {
          continue;
        }
        result.runCount += 1;
        const pruned = await pruneExploreRun({ artifact, artifactPath, reportsDir });
        if (pruned.removedModelIds.length) {
          result.prunedRunCount += 1;
          result.removedModelSummaries += pruned.removedModelIds.length;
          result.removedArtifactPaths += pruned.removedArtifactPaths;
          emitExperimentLog(
            onLog,
            `[${kind}] Removed non-reportable model data from ${artifact.runId}: ${pruned.removedModelIds.join(", ")}`
          );
        }
        continue;
      }

      const artifact = await readJsonFile<HealRunArtifact>(artifactPath);
      if (artifact.kind !== "heal") {
        continue;
      }
      result.runCount += 1;
      const pruned = await pruneHealRun({ artifact, artifactPath, reportsDir, runsRoot });
      if (pruned.removedModelIds.length) {
        result.prunedRunCount += 1;
        result.removedModelSummaries += pruned.removedModelIds.length;
        result.removedArtifactPaths += pruned.removedArtifactPaths;
        emitExperimentLog(
          onLog,
          `[${kind}] Removed non-reportable model data from ${artifact.runId}: ${pruned.removedModelIds.join(", ")}`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        emitExperimentLog(
          onLog,
          `[${kind}] Skipped pruning ${entry.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      continue;
    }
  }

  return result;
}

function describePruneResult(result: PruneNonReportableBenchmarkArtifactsResult): string {
  return `${result.removedModelSummaries} model summary/summaries across ${result.prunedRunCount} run(s)`;
}

async function listExistingModelSummaries(kind: "qa", resultsDir: string): Promise<ExistingQaModelSummary[]>;
async function listExistingModelSummaries(kind: "explore", resultsDir: string): Promise<ExistingExploreModelSummary[]>;
async function listExistingModelSummaries(kind: "heal", resultsDir: string): Promise<ExistingHealModelSummary[]>;
async function listExistingModelSummaries(
  kind: BenchmarkRunKind,
  resultsDir: string
): Promise<ExistingModelSummary[]> {
  const runsDir = join(await resolveExperimentRoot(resultsDir, kind), "runs");
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const latest = new Map<string, ExistingModelSummary>();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runPath = join(runsDir, entry.name, "run.json");
    try {
      if (kind === "qa") {
        const artifact = await readJsonFile<QaRunArtifact>(runPath);
        if (artifact.kind !== "qa" || !artifact.appId || !Array.isArray(artifact.modelSummaries)) {
          continue;
        }
        const timestamp = reportTimestamp(artifact.finishedAt) || reportTimestamp(artifact.startedAt);
        for (const summary of artifact.modelSummaries) {
          const modelId = summary.metrics.modelId || summary.model.id;
          if (!modelId || !hasReusableQaData(summary)) {
            continue;
          }
          keepLatestExistingSummary(latest, {
            kind,
            appId: artifact.appId,
            modelId,
            sourceRunId: artifact.runId,
            timestamp,
            summary
          });
        }
        continue;
      }

      if (kind === "explore") {
        const artifact = await readJsonFile<ExploreRunArtifact>(runPath);
        if (artifact.kind !== "explore" || !artifact.appId || !Array.isArray(artifact.modelSummaries)) {
          continue;
        }
        const timestamp = reportTimestamp(artifact.finishedAt) || reportTimestamp(artifact.startedAt);
        for (const summary of artifact.modelSummaries) {
          const modelId = summary.metrics.modelId || summary.model.id;
          if (!modelId || !hasReusableExploreData(summary)) {
            continue;
          }
          keepLatestExistingSummary(latest, {
            kind,
            appId: artifact.appId,
            modelId,
            sourceRunId: artifact.runId,
            timestamp,
            summary
          });
        }
        continue;
      }

      const artifact = await readJsonFile<HealRunArtifact>(runPath);
      if (artifact.kind !== "heal" || !artifact.appId || !Array.isArray(artifact.modelSummaries)) {
        continue;
      }
      const timestamp = reportTimestamp(artifact.finishedAt) || reportTimestamp(artifact.startedAt);
      for (const summary of artifact.modelSummaries) {
        const modelId = summary.metrics.modelId || summary.model.id;
        if (!modelId || !hasReusableHealData(summary)) {
          continue;
        }
        keepLatestExistingSummary(latest, {
          kind,
          appId: artifact.appId,
          modelId,
          sourceRunId: artifact.runId,
          timestamp,
          summary
        });
      }
    } catch {
      continue;
    }
  }

  return [...latest.values()];
}

type LatestBenchmarkReportRecord = {
  kind: BenchmarkRunKind;
  report: SavedBenchmarkReport;
  reportPath: string;
};

type SelectedBenchmarkRowRecord = LatestBenchmarkReportRecord & {
  appId: string;
  modelId: string;
  generatedAt: string;
  runId: string;
  row: BenchmarkComparisonRow;
};

async function hydrateSavedBenchmarkReport(
  kind: BenchmarkRunKind,
  resultsDir: string,
  report: SavedBenchmarkReport
): Promise<SavedBenchmarkReport> {
  if (kind !== "heal") {
    return report;
  }

  try {
    const root = await resolveExperimentRoot(resultsDir, "heal");
    const artifact = await readJsonFile<HealRunArtifact>(join(root, "runs", report.runId, "run.json"));
    if (artifact.kind !== "heal") {
      return report;
    }

    const rebuilt = buildHealReport(artifact);
    return {
      kind: "heal",
      runId: rebuilt.runId,
      appId: rebuilt.appId,
      generatedAt: report.generatedAt,
      section: rebuilt.section
    };
  } catch {
    return report;
  }
}

async function listBenchmarkRunReports(
  kind: BenchmarkRunKind,
  resultsDir: string
): Promise<LatestBenchmarkReportRecord[]> {
  const reportsDir = join(await resolveExperimentRoot(resultsDir, kind), "reports");
  let entries;
  try {
    entries = await readdir(reportsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const reports: LatestBenchmarkReportRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const reportPath = join(reportsDir, entry.name);
    try {
      const savedReport = await readJsonFile<SavedBenchmarkReport>(reportPath);
      const report = await hydrateSavedBenchmarkReport(kind, resultsDir, savedReport);
      if (
        benchmarkRunKind(report.runId) !== kind ||
        typeof report.appId !== "string" ||
        typeof report.generatedAt !== "string"
      ) {
        continue;
      }
      reports.push({
        kind,
        report,
        reportPath
      });
    } catch {
      continue;
    }
  }

  return reports;
}

function selectLatestBenchmarkReportRows(records: LatestBenchmarkReportRecord[]): SelectedBenchmarkRowRecord[] {
  const latestByModel = new Map<string, SelectedBenchmarkRowRecord>();
  for (const record of records) {
    for (const row of record.report.section.rows) {
      if (!isReportableComparisonRow(row)) {
        continue;
      }
      const candidate: SelectedBenchmarkRowRecord = {
        ...record,
        appId: record.report.appId,
        modelId: row.modelId,
        generatedAt: record.report.generatedAt,
        runId: record.report.runId,
        row
      };
      const key = `${candidate.kind}:${candidate.appId}:${candidate.modelId}`;
      const current = latestByModel.get(key);
      if (!current) {
        latestByModel.set(key, candidate);
        continue;
      }

      const freshness =
        reportTimestamp(candidate.generatedAt) - reportTimestamp(current.generatedAt) ||
        candidate.runId.localeCompare(current.runId) ||
        candidate.reportPath.localeCompare(current.reportPath);
      if (freshness > 0) {
        latestByModel.set(key, candidate);
      }
    }
  }

  return sortSelections([...latestByModel.values()]);
}

function toProvenance(
  selectedReports: RebuiltBenchmarkReportSelection[],
  note: string
): BenchmarkComparisonProvenance {
  return {
    selectionPolicy: "latest-per-app-mode-model",
    note,
    selectedReports: sortSelections(
      selectedReports.map<BenchmarkComparisonProvenanceEntry>((entry) => ({
        kind: entry.kind,
        appId: entry.appId,
        modelId: entry.modelId,
        runId: entry.runId,
        generatedAt: entry.generatedAt,
        reportPath: entry.reportPath
      }))
    )
  };
}

function singleRunReportTitle(kind: BenchmarkRunKind, appId: string): string {
  if (kind === "qa") {
    return `${appId} Guided Report`;
  }
  if (kind === "explore") {
    return `${appId} Explore Report`;
  }
  return `${appId} Self-Heal Report`;
}

function singleRunReportSubtitle(kind: BenchmarkRunKind, modelCount: number): string {
  if (kind === "qa") {
    return `Matrix summary for guided execution across ${modelCount} model(s).`;
  }
  if (kind === "explore") {
    return `Matrix summary for autonomous exploration across ${modelCount} model(s).`;
  }
  return `Matrix summary for repair evaluation across ${modelCount} model(s).`;
}

function toSingleRunComparisonReport(savedReport: SavedBenchmarkReport, reportPath: string): BenchmarkComparisonReport {
  const kind = benchmarkRunKind(savedReport.runId);
  if (!kind) {
    throw new Error(`unsupported saved benchmark report ${savedReport.runId}`);
  }

  return {
    title: singleRunReportTitle(kind, savedReport.appId),
    subtitle: singleRunReportSubtitle(kind, savedReport.section.rows.length),
    generatedAt: savedReport.generatedAt,
    runIds: [savedReport.runId],
    appIds: [savedReport.appId],
    modeSections: [savedReport.section],
    finalReportPath: reportPath.replace(/\.json$/i, ".html"),
    finalJsonPath: reportPath
  };
}

function renderSavedComparisonHtml(reportPath: string, report: BenchmarkComparisonReport): string {
  const fileName = basename(reportPath).toLowerCase();
  if (fileName.includes("standardized")) {
    return renderBenchmarkStandardizedComparisonHtml(report);
  }
  if (report.modeSections.length > 1) {
    return renderBenchmarkFinalComparisonHtml(report);
  }
  return renderBenchmarkComparisonHtml(report);
}

async function rebuildSavedModeReportHtml(kind: BenchmarkRunKind, resultsDir: string): Promise<void> {
  const reportsDir = join(await resolveExperimentRoot(resultsDir, kind), "reports");
  let entries;
  try {
    entries = await readdir(reportsDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        return;
      }

      const reportPath = join(reportsDir, entry.name);
      try {
        const rawSavedReport = await readJsonFile<SavedBenchmarkReport>(reportPath);
        const savedReport = await hydrateSavedBenchmarkReport(kind, resultsDir, rawSavedReport);
        if (benchmarkRunKind(savedReport.runId) !== kind) {
          return;
        }
        const htmlReport = toSingleRunComparisonReport(savedReport, reportPath);
        await writeText(join(reportsDir, `${basename(entry.name, ".json")}.html`), renderBenchmarkComparisonHtml(htmlReport));
      } catch {
        return;
      }
    })
  );
}

async function rebuildSavedComparisonHtml(resultsDir: string): Promise<void> {
  const compareDir = join(await resolveWorkspacePath(resultsDir), "compare");
  let entries;
  try {
    entries = await readdir(compareDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        return;
      }

      const reportPath = join(compareDir, entry.name);
      try {
        const report = await readJsonFile<BenchmarkComparisonReport>(reportPath);
        await writeText(join(compareDir, `${basename(entry.name, ".json")}.html`), renderSavedComparisonHtml(reportPath, report));
      } catch {
        return;
      }
    })
  );
}

async function rebuildAllSavedBenchmarkHtml(resultsDir: string): Promise<void> {
  await Promise.all([
    rebuildSavedModeReportHtml("qa", resultsDir),
    rebuildSavedModeReportHtml("explore", resultsDir),
    rebuildSavedModeReportHtml("heal", resultsDir),
    rebuildSavedComparisonHtml(resultsDir)
  ]);
}

async function persistModeComparisonForReports(
  kind: BenchmarkRunKind,
  reports: SavedBenchmarkReport[],
  runIds: string[],
  resultsDir: string,
  provenance?: BenchmarkComparisonProvenance
): Promise<{
  kind: ExperimentKind;
  appIds: string[];
  runIds: string[];
  finalReportPath: string;
  finalJsonPath: string;
  modeSection: BenchmarkComparisonReport["modeSections"][number];
}> {
  const built = compareByKind(kind, reports);
  const config = comparisonConfig(kind);
  const finalReport = await persistLatestComparisonReport({
    title: config.title,
    subtitle: `Matrix comparison across ${unique(runIds).length} ${config.subtitleNoun} run(s).`,
    runIds: unique(runIds),
    modeSections: [built.modeSection],
    resultsDir,
    prefix: config.prefix,
    provenance,
    htmlVariant: "mode"
  });

  return {
    kind,
    appIds: finalReport.appIds,
    runIds: finalReport.runIds,
    finalReportPath: finalReport.finalReportPath,
    finalJsonPath: finalReport.finalJsonPath,
    modeSection: built.modeSection
  };
}

export async function listTargets(appsRoot = "apps") {
  return listBenchmarkTargets(appsRoot);
}

export async function listSuites(appsRoot = "apps"): Promise<BenchmarkSuiteDescriptor[]> {
  const targets = await listBenchmarkTargets(appsRoot);
  const suites: BenchmarkSuiteDescriptor[] = [];

  for (const target of targets) {
    try {
      const benchmark = await loadAppBenchmark(target.targetId, appsRoot);
      suites.push({
        appId: benchmark.benchmark.appId,
        displayName: benchmark.benchmark.displayName,
        suitePath: benchmark.manifestPath,
        targetId: benchmark.target.target.targetId,
        prompts: benchmark.benchmark.prompts,
        runtime: benchmark.benchmark.runtime
      });
    } catch {
      continue;
    }
  }

  return suites.sort((left, right) => left.appId.localeCompare(right.appId));
}

async function resolveSuiteAppIds(appsRoot = "apps"): Promise<string[]> {
  const suites = await listSuites(appsRoot);
  const appIds = suites.map((suite) => suite.appId);
  if (!appIds.length) {
    throw new Error(`no benchmark suites found under ${appsRoot}`);
  }
  return appIds;
}

async function runExperimentAcrossApps<TCompare extends {
  finalReportPath: string;
  finalJsonPath: string;
}>(input: {
  mode: ExperimentKind;
  appsRoot?: string;
  appParallelism?: number;
  onLog?: ExperimentLogFn;
  beforeAll?: (appIds: string[]) => Promise<void>;
  runForApp: (appId: string) => Promise<{
    artifact: {
      runId: string;
    };
    artifactPath: string;
    reportPath: string;
    htmlPath: string;
  }>;
  compare: (runIds: string[]) => Promise<TCompare>;
}): Promise<{
  appIds: string[];
  runs: MultiAppExperimentRunEntry[];
  comparison: TCompare;
}> {
  const appIds = await resolveSuiteAppIds(input.appsRoot);
  const appParallelism = resolveParallelism(input.appParallelism);
  emitExperimentLog(
    input.onLog,
    `[${input.mode}] Starting multi-app run across ${appIds.length} app(s): ${appIds.join(", ")} (app parallelism ${appParallelism})`
  );
  await input.beforeAll?.(appIds);

  const runs = await mapWithConcurrency(appIds, appParallelism, async (appId, appIndex) => {
    emitExperimentLog(
      input.onLog,
      `[${input.mode}] App ${appIndex + 1}/${appIds.length} ${appId}: started`
    );
    const result = await input.runForApp(appId);
    emitExperimentLog(
      input.onLog,
      `[${input.mode}] App ${appIndex + 1}/${appIds.length} ${appId}: completed (${result.artifact.runId})`
    );
    return {
      appId,
      runId: result.artifact.runId,
      artifactPath: result.artifactPath,
      reportPath: result.reportPath,
      htmlPath: result.htmlPath
    };
  });

  emitExperimentLog(
    input.onLog,
    `[${input.mode}] Comparing ${runs.length} run(s) across ${appIds.length} app(s)`
  );
  const comparison = await input.compare(runs.map((run) => run.runId));
  emitExperimentLog(
    input.onLog,
    `[${input.mode}] Multi-app run completed. Final report: ${comparison.finalReportPath}`
  );

  return {
    appIds,
    runs,
    comparison
  };
}

export async function describeTarget(targetId: string, appsRoot = "apps") {
  const [target, benchmark] = await Promise.all([
    describeBenchmarkTarget(targetId, appsRoot),
    loadAppBenchmark(targetId, appsRoot)
  ]);

  return {
    target: target.target,
    manifestPath: target.manifestPath,
    templatePath: target.templatePath,
    rootDir: target.rootDir,
    scenarios: target.scenarios,
    bugs: target.bugs,
    benchmark: {
      manifestPath: benchmark.manifestPath,
      appId: benchmark.benchmark.appId,
      displayName: benchmark.benchmark.displayName,
      prompts: benchmark.benchmark.prompts,
      runtime: benchmark.benchmark.runtime,
      capabilities: benchmark.benchmark.capabilities,
      guided: benchmark.benchmark.guided,
      explore: benchmark.benchmark.explore,
      heal: benchmark.benchmark.heal
    }
  };
}

export async function runBenchmarkSuite(input: RunBenchmarkSuiteInput) {
  await loadProjectEnv();
  const suiteStartedAtMs = Date.now();

  const suite = await resolveSuiteManifest(input.suitePath);
  const resultsDir = input.resultsDir ?? "results";
  emitExperimentLog(input.onLog, `[suite] Starting benchmark suite for ${suite.appId}`);
  const qa = await runQaExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.qaRunner,
    onLog: input.onLog
  });
  const explore = await runExploreExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.exploreRunner,
    onLog: input.onLog
  });
  const heal = await runHealExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.healRunner,
    repairClient: input.repairClient,
    onLog: input.onLog
  });
  emitExperimentLog(
    input.onLog,
    `[suite] Comparing runs ${qa.artifact.runId}, ${explore.artifact.runId}, ${heal.artifact.runId}`
  );
  const comparison = await compareBenchmarkRuns(
    [qa.artifact.runId, explore.artifact.runId, heal.artifact.runId],
    resultsDir
  );
  emitExperimentLog(
    input.onLog,
    `[suite] Completed benchmark suite for ${suite.appId} in ${formatDurationMs(Date.now() - suiteStartedAtMs)}. Final report: ${comparison.finalReportPath}`
  );

  return {
    appId: suite.appId,
    suitePath: suite.suitePath,
    qa: {
      runId: qa.artifact.runId,
      artifactPath: qa.artifactPath,
      reportPath: qa.reportPath,
      htmlPath: qa.htmlPath
    },
    explore: {
      runId: explore.artifact.runId,
      artifactPath: explore.artifactPath,
      reportPath: explore.reportPath,
      htmlPath: explore.htmlPath
    },
    heal: {
      runId: heal.artifact.runId,
      artifactPath: heal.artifactPath,
      reportPath: heal.reportPath,
      htmlPath: heal.htmlPath
    },
    finalReportPath: comparison.finalReportPath,
    finalJsonPath: comparison.finalJsonPath,
    comparison
  };
}

export async function runQaAcrossApps(input: RunQaAcrossAppsInput): Promise<RunQaAcrossAppsResult> {
  await loadProjectEnv();
  const resultsDir = input.resultsDir ?? "results";
  if (input.skipExisting) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("qa", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[qa] Skip-existing cleanup removed ${describePruneResult(pruned)}`);
    }
  }
  const reusableModelSummaries = input.skipExisting ? await listExistingModelSummaries("qa", resultsDir) : [];
  if (input.skipExisting) {
    emitExperimentLog(
      input.onLog,
      `[qa] Skip-existing enabled; found ${reusableModelSummaries.length} existing app/model combination(s)`
    );
  }
  const multiRun = await runExperimentAcrossApps({
    mode: "qa",
    appsRoot: input.appsRoot,
    appParallelism: input.appParallelism,
    onLog: input.onLog,
    beforeAll:
      input.resetModeResults === false || input.skipExisting
        ? undefined
        : async () => {
            await clearQaOutputs(resultsDir);
          },
    runForApp: async (appId) => {
      const appReusableModelSummaries = reusableModelSummaries
        .filter((entry) => entry.appId === appId)
        .map((entry) => ({
          sourceRunId: entry.sourceRunId,
          summary: entry.summary
        }));
      const result = await runQaExperiment({
        appId,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        timeoutMs: input.timeoutMs,
        retryCount: input.retryCount,
        maxSteps: input.maxSteps,
        maxOutputTokens: input.maxOutputTokens,
        viewport: input.viewport,
        parallelism: input.parallelism,
        resultsDir,
        resetModeResults: false,
        runner: input.runner,
        reusableModelSummaries: appReusableModelSummaries,
        onLog: input.onLog
      });
      return result;
    },
    compare: (runIds) => compareQaRuns(runIds, resultsDir)
  });

  if (input.cleanupFailedArtifacts) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("qa", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[qa] Fullbench cleanup removed ${describePruneResult(pruned)}`);
    }
  }

  return {
    mode: "qa",
    appIds: multiRun.appIds,
    runs: multiRun.runs,
    finalReportPath: multiRun.comparison.finalReportPath,
    finalJsonPath: multiRun.comparison.finalJsonPath,
    comparison: multiRun.comparison
  };
}

export async function runExploreAcrossApps(input: RunExploreAcrossAppsInput): Promise<RunExploreAcrossAppsResult> {
  await loadProjectEnv();
  const resultsDir = input.resultsDir ?? "results";
  if (input.skipExisting) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("explore", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[explore] Skip-existing cleanup removed ${describePruneResult(pruned)}`);
    }
  }
  const reusableModelSummaries = input.skipExisting ? await listExistingModelSummaries("explore", resultsDir) : [];
  if (input.skipExisting) {
    emitExperimentLog(
      input.onLog,
      `[explore] Skip-existing enabled; found ${reusableModelSummaries.length} existing app/model combination(s)`
    );
  }
  const multiRun = await runExperimentAcrossApps({
    mode: "explore",
    appsRoot: input.appsRoot,
    appParallelism: input.appParallelism,
    onLog: input.onLog,
    beforeAll:
      input.resetModeResults === false || input.skipExisting
        ? undefined
        : async () => {
            await clearExploreOutputs(resultsDir);
          },
    runForApp: async (appId) => {
      const appReusableModelSummaries = reusableModelSummaries
        .filter((entry) => entry.appId === appId)
        .map((entry) => ({
          sourceRunId: entry.sourceRunId,
          summary: entry.summary
        }));
      const result = await runExploreExperiment({
        appId,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        parallelism: input.parallelism,
        resultsDir,
        resetModeResults: false,
        runner: input.runner,
        reusableModelSummaries: appReusableModelSummaries,
        onLog: input.onLog
      });
      return result;
    },
    compare: (runIds) => compareExploreRuns(runIds, resultsDir)
  });

  if (input.cleanupFailedArtifacts) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("explore", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[explore] Fullbench cleanup removed ${describePruneResult(pruned)}`);
    }
  }

  return {
    mode: "explore",
    appIds: multiRun.appIds,
    runs: multiRun.runs,
    finalReportPath: multiRun.comparison.finalReportPath,
    finalJsonPath: multiRun.comparison.finalJsonPath,
    comparison: multiRun.comparison
  };
}

export async function runHealAcrossApps(input: RunHealAcrossAppsInput): Promise<RunHealAcrossAppsResult> {
  await loadProjectEnv();
  const resultsDir = input.resultsDir ?? "results";
  if (input.skipExisting) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("heal", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[heal] Skip-existing cleanup removed ${describePruneResult(pruned)}`);
    }
  }
  const reusableModelSummaries = input.skipExisting ? await listExistingModelSummaries("heal", resultsDir) : [];
  if (input.skipExisting) {
    emitExperimentLog(
      input.onLog,
      `[heal] Skip-existing enabled; found ${reusableModelSummaries.length} existing app/model combination(s)`
    );
  }
  const multiRun = await runExperimentAcrossApps({
    mode: "heal",
    appsRoot: input.appsRoot,
    appParallelism: input.appParallelism,
    onLog: input.onLog,
    beforeAll:
      input.resetModeResults === false || input.skipExisting
        ? undefined
        : async () => {
            await clearHealOutputs(resultsDir);
          },
    runForApp: async (appId) => {
      const appReusableModelSummaries = reusableModelSummaries
        .filter((entry) => entry.appId === appId)
        .map((entry) => ({
          sourceRunId: entry.sourceRunId,
          summary: entry.summary
        }));
      const result = await runHealExperiment({
        appId,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        parallelism: input.parallelism,
        resultsDir,
        resetModeResults: false,
        runner: input.runner,
        repairClient: input.repairClient,
        reusableModelSummaries: appReusableModelSummaries,
        onLog: input.onLog
      });
      return result;
    },
    compare: (runIds) => compareHealRuns(runIds, resultsDir)
  });

  if (input.cleanupFailedArtifacts) {
    const pruned = await pruneNonReportableBenchmarkArtifacts("heal", resultsDir, input.onLog);
    if (pruned.removedModelSummaries > 0) {
      emitExperimentLog(input.onLog, `[heal] Fullbench cleanup removed ${describePruneResult(pruned)}`);
    }
  }

  return {
    mode: "heal",
    appIds: multiRun.appIds,
    runs: multiRun.runs,
    finalReportPath: multiRun.comparison.finalReportPath,
    finalJsonPath: multiRun.comparison.finalJsonPath,
    comparison: multiRun.comparison
  };
}

export async function getBenchmarkReport(runId: string, resultsDir = "results") {
  const kind = benchmarkRunKind(runId);
  if (kind === "qa") {
    return getQaReport(runId, resultsDir);
  }
  if (kind === "explore") {
    return getExploreReport(runId, resultsDir);
  }
  if (kind === "heal") {
    return getHealReport(runId, resultsDir);
  }
  if (runId.startsWith("guided-")) {
    return readJsonFile<RuntimeGuidedRunRecord>(
      join(await resolveRuntimeRoot(resultsDir, "guided"), "runs", runId, "run.json")
    );
  }
  if (runId.startsWith("runtime-explore-")) {
    return readJsonFile<RuntimeExploreRunRecord>(
      join(await resolveRuntimeRoot(resultsDir, "runtime-explore"), "runs", runId, "run.json")
    );
  }
  if (runId.startsWith("repair-")) {
    return readJsonFile<RuntimeHealRunRecord>(
      join(await resolveRuntimeRoot(resultsDir, "runtime-heal"), "runs", runId, "run.json")
    );
  }
  throw new Error(`unsupported run id ${runId}`);
}

export async function compareBenchmarkRuns(runIds: string[], resultsDir = "results"): Promise<BenchmarkComparisonReport> {
  const grouped = new Map<BenchmarkRunKind, string[]>();

  for (const runId of runIds) {
    const kind = benchmarkRunKind(runId);
    if (!kind) {
      throw new Error(`comparison only supports benchmark run ids (guided-, explore-, heal-); got ${runId}`);
    }
    grouped.set(kind, [...(grouped.get(kind) ?? []), runId]);
  }

  const comparisons = await Promise.all(
    [...grouped.entries()].map(async ([kind, kindRunIds]) => {
      const reports = await Promise.all(kindRunIds.map((runId) => getBenchmarkReportByKind(kind, runId, resultsDir)));
      return [kind, compareByKind(kind, reports)] as const;
    })
  );
  return persistLatestComparisonReport({
    title: "Benchmark Final Report",
    subtitle: `Matrix comparison across ${unique(runIds).length} benchmark run(s).`,
    runIds: unique(runIds),
    modeSections: comparisons.map(([, comparison]) => comparison.modeSection),
    resultsDir,
    prefix: "benchmark-compare",
    htmlVariant: "benchmark-final"
  });
}

export async function rebuildBenchmarkReports(
  input: RebuildBenchmarkReportsInput = {}
): Promise<RebuildBenchmarkReportsResult> {
  await loadProjectEnv();
  const resultsDir = input.resultsDir ?? "results";
  const htmlScope = input.htmlScope ?? "compare";
  const requestedKinds = input.mode ? [input.mode] : (["qa", "explore", "heal"] as const);
  const selectedRecordsByKind = new Map<BenchmarkRunKind, SelectedBenchmarkRowRecord[]>();

  for (const kind of requestedKinds) {
    const records = await listBenchmarkRunReports(kind, resultsDir);
    const selected = selectLatestBenchmarkReportRows(records);
    if (selected.length > 0) {
      selectedRecordsByKind.set(kind, selected);
    }
  }

  if (input.mode && !selectedRecordsByKind.has(input.mode)) {
    throw new Error(`no ${input.mode} benchmark reports found under ${resultsDir}`);
  }
  if (!selectedRecordsByKind.size) {
    throw new Error(`no benchmark reports found under ${resultsDir}`);
  }

  const selectedReports = sortSelections(
    [...selectedRecordsByKind.values()].flat().map<RebuiltBenchmarkReportSelection>((record) => ({
      kind: record.kind,
      appId: record.appId,
      modelId: record.modelId,
      runId: record.runId,
      generatedAt: record.generatedAt,
      reportPath: record.reportPath
    }))
  );

  const modeReports: RebuiltModeReport[] = [];
  const modeSections: BenchmarkComparisonReport["modeSections"] = [];

  for (const kind of requestedKinds) {
    const selected = selectedRecordsByKind.get(kind);
    if (!selected?.length) {
      continue;
    }

    const selectedRunIds = unique(selected.map((item) => item.runId));
    const reportsByPath = new Map<string, SavedBenchmarkReport>();
    for (const record of selected) {
      const existing = reportsByPath.get(record.reportPath);
      if (existing) {
        existing.section.rows.push(record.row);
      } else {
        reportsByPath.set(record.reportPath, {
          ...record.report,
          section: {
            ...record.report.section,
            rows: [record.row]
          }
        });
      }
    }

    const selectedReportsForComparison = [...reportsByPath.values()];
    const rebuilt = await persistModeComparisonForReports(
      kind,
      selectedReportsForComparison,
      selectedRunIds,
      resultsDir,
      toProvenance(
        selectedReports.filter((item) => item.kind === kind),
        "Rebuilt from the latest available report per app and model for this mode; report timestamps may differ across app cells."
      )
    );
    modeReports.push({
      kind: rebuilt.kind,
      appIds: rebuilt.appIds,
      runIds: rebuilt.runIds,
      finalReportPath: rebuilt.finalReportPath,
      finalJsonPath: rebuilt.finalJsonPath
    });
    modeSections.push(rebuilt.modeSection);
  }

  let finalReportPath: string | undefined;
  let finalJsonPath: string | undefined;
  if (!input.mode) {
    const finalReport = await persistLatestComparisonReport({
      title: "Benchmark Final Report",
      subtitle: `Matrix comparison across ${unique(selectedReports.map((item) => item.runId)).length} benchmark run(s).`,
      runIds: unique(selectedReports.map((item) => item.runId)),
      modeSections,
      resultsDir,
      prefix: "benchmark-compare",
      htmlVariant: "benchmark-final",
      provenance: toProvenance(
        selectedReports,
        "Rebuilt from the latest available report per mode, app, and model; report timestamps may differ across sections."
      )
    });
    finalReportPath = finalReport.finalReportPath;
    finalJsonPath = finalReport.finalJsonPath;
  }

  if (htmlScope === "all") {
    await rebuildAllSavedBenchmarkHtml(resultsDir);
  }

  return {
    selectionPolicy: "latest-per-app-mode-model",
    selectedReports,
    modeReports,
    finalReportPath,
    finalJsonPath
  };
}

export async function exploreTarget(input: ExploreTargetInput) {
  await loadProjectEnv();

  const benchmark = await loadAppBenchmark(input.targetId);
  const runtime = resolveRuntimeConfig(benchmark.benchmark, input);
  const model = await resolveSingleModel(input.modelId, input.modelsPath);
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveRuntimeRoot(resultsDir, "runtime-explore");
  const runId = `runtime-explore-${input.targetId}-${Date.now()}`;
  const bugIds = input.bugIds ?? [];
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    scenarioIds: benchmark.benchmark.explore.probeScenarioIds,
    bugIds,
    explorationMode: "autonomous",
    suiteId: runId,
    resultsDir,
    runtime,
    promptIds: {
      guided: benchmark.benchmark.prompts.guided,
      autonomous: input.prompt
    }
  });

  await ensureDir(resultsRoot);
  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });
  const cacheConfig = await resolveExecutionCacheConfig({
    resultsDir,
    targetId: input.targetId,
    bugIds,
    viewport: runtime.viewport,
    modelId: model.id,
    configSignature: buildStagehandConfigSignature({
      executionKind: "explore",
      instructionPrompt: input.prompt
    })
  });
  const runner = input.runner ?? new StagehandAutomationRunner();
  if (typeof runner.exploreTarget !== "function") {
    throw new Error("selected automation runner does not support runtime exploration");
  }

  const aut = await startAut(workspace.aut);
  try {
    const artifact = await runner.exploreTarget({
      model,
      trial: 1,
      targetId: input.targetId,
      bugIds,
      prompt: input.prompt,
      aut: workspace.aut,
      runConfig: runtime,
      cacheConfig,
      workspacePath: workspace.workspacePath
    });
    const artifactPath = await persistRunExplorationArtifacts(resultsRoot, runId, artifact);
    const record: RuntimeExploreRunRecord = {
      kind: "runtime-explore",
      runId,
      targetId: input.targetId,
      modelId: model.id,
      bugIds,
      prompt: input.prompt,
      runtime,
      cacheConfig,
      startedAt: artifact.startedAt,
      finishedAt: artifact.finishedAt,
      workspacePath: workspace.workspacePath,
      explorationRunId: artifact.explorationRunId,
      artifactPath,
      cacheSummary: artifact.cacheSummary,
      summary: artifact.summary
    };
    const runPath = join(resultsRoot, "runs", runId, "run.json");
    await writeJson(runPath, record);

    return {
      ...record,
      runPath
    };
  } finally {
    await aut?.stop();
  }
}

export async function runGuided(input: RunGuidedInput) {
  await loadProjectEnv();

  const benchmark = await loadAppBenchmark(input.targetId);
  const runtime = resolveRuntimeConfig(benchmark.benchmark, input);
  const model = await resolveSingleModel(input.modelId, input.modelsPath);
  const resultsDir = input.resultsDir ?? "results";
  const resultsRoot = await resolveRuntimeRoot(resultsDir, "guided");
  const runId = `guided-${input.targetId}-${Date.now()}`;
  const bugIds = input.bugIds ?? [];
  const promptId = input.guidedPromptId ?? benchmark.benchmark.prompts.guided;
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    scenarioIds: input.scenarioIds,
    bugIds,
    explorationMode: "guided",
    suiteId: runId,
    resultsDir,
    runtime,
    promptIds: {
      guided: promptId
    }
  });

  await ensureDir(resultsRoot);
  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });

  let explorationCacheUsage: ExplorationCacheUsage | undefined;
  if (input.explorationRunId) {
    const located = await findExplorationArtifact(input.explorationRunId, resultsDir);
    if (!located) {
      explorationCacheUsage = {
        explorationRunId: input.explorationRunId,
        compatible: false,
        reason: "exploration artifact not found",
        matchedActions: 0
      };
    } else {
      explorationCacheUsage = resolveExplorationCompatibility({
        artifact: located.artifact,
        targetId: input.targetId,
        bugIds,
        modelId: model.id,
        viewport: runtime.viewport
      });
    }
  }

  const cacheConfig = await resolveExecutionCacheConfig({
    resultsDir,
    targetId: input.targetId,
    bugIds,
    viewport: runtime.viewport,
    modelId: model.id,
    configSignature: buildStagehandConfigSignature({
      executionKind: "guided",
      systemPrompt: resolvedSuite.prompts.guided
    })
  });

  const runner = input.runner ?? new StagehandAutomationRunner();
  const aut = await startAut(workspace.aut);
  try {
    const execution = await executeGuidedScenarios({
      runId,
      resultsRoot,
      resolvedSuite,
      workspace,
      model,
      runner,
      trial: 1,
      systemPrompt: resolvedSuite.prompts.guided,
      includeFindings: true
    });

    const record: RuntimeGuidedRunRecord = {
      kind: "guided",
      runId,
      targetId: input.targetId,
      modelId: model.id,
      scenarioIds: input.scenarioIds,
      bugIds,
      promptId,
      runtime,
      cacheConfig,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      workspacePath: workspace.workspacePath,
      validationCommand: workspace.validationCommand,
      explorationCacheUsage,
      cacheSummary: summarizeScenarioRunCache(execution.scenarioRuns),
      scenarioRuns: execution.scenarioRuns,
      findings: execution.findings
    };
    const runPath = join(resultsRoot, "runs", runId, "run.json");
    await writeJson(runPath, record);

    return {
      ...record,
      summary: summarizeScenarioRuns(execution.scenarioRuns),
      runPath
    };
  } finally {
    await aut?.stop();
  }
}

export async function runSelfHeal(input: RunSelfHealInput) {
  await loadProjectEnv();

  const resultsDir = input.resultsDir ?? "results";
  const guidedRoot = await resolveRuntimeRoot(resultsDir, "guided");
  const guidedRun = await readJsonFile<RuntimeGuidedRunRecord>(join(guidedRoot, "runs", input.runId, "run.json"));
  const finding = guidedRun.findings.find((item) => item.id === input.findingId);
  if (!finding) {
    throw new Error(`finding ${input.findingId} not found in run ${input.runId}`);
  }

  const repairRoot = await resolveRuntimeRoot(resultsDir, "runtime-heal");
  const repairRunId = `repair-${guidedRun.targetId}-${Date.now()}`;
  const runDir = join(repairRoot, "runs", repairRunId);
  await ensureDir(runDir);

  const stdoutPath = join(runDir, "agent.stdout.txt");
  const stderrPath = join(runDir, "agent.stderr.txt");
  const findingPath = join(runDir, "finding.json");
  const validationCommand = input.validationCommand ?? guidedRun.validationCommand;
  const scenarioRuns = guidedRun.scenarioRuns.filter((scenarioRun) => scenarioRun.scenarioId === finding.scenarioId);
  const candidateFiles = await readCandidateFileSnippets({
    workspacePath: guidedRun.workspacePath,
    candidates: finding.sourceCandidates.map((candidate) => ({
      workspaceRelativePath: candidate.workspaceRelativePath,
      reasons: candidate.reasons
    })),
    limit: 3
  });
  const agentResult = await runAgentForPatch({
    command: input.agentCommand,
    cwd: guidedRun.workspacePath,
    context: {
      targetId: guidedRun.targetId,
      runId: guidedRun.runId,
      finding,
      scenarioRuns,
      candidateFiles,
      validationCommand
    }
  });

  await writeText(stdoutPath, agentResult.stdout);
  await writeText(stderrPath, agentResult.stderr);
  await writeJson(findingPath, finding);

  let patchPath: string | undefined;
  let repair: RuntimeHealRunRecord["repair"];
  if (agentResult.patch) {
    const patch = agentResult.patch;
    patchPath = join(runDir, "repair.patch");
    await writeText(patchPath, patch);
    const result = await applyPatchInIsolatedWorktree({
      cwd: guidedRun.workspacePath,
      patch,
      validationCommand,
      attemptId: `${repairRunId}-${finding.scenarioId}-${finding.stepId}`
    });
    repair = {
      ...result,
      patchPath
    };
  } else {
    repair = {
      outcome: "skipped",
      note:
        agentResult.exitCode === 0
          ? "agent did not return a unified diff patch"
          : `agent command failed with exit code ${agentResult.exitCode}`
    };
  }

  const record: RuntimeHealRunRecord = {
    kind: "runtime-heal",
    runId: repairRunId,
    sourceRunId: guidedRun.runId,
    findingId: input.findingId,
    targetId: guidedRun.targetId,
    workspacePath: guidedRun.workspacePath,
    validationCommand,
    agentCommand: input.agentCommand,
    createdAt: nowIso(),
    patchPath,
    agent: {
      exitCode: agentResult.exitCode,
      stdoutPath,
      stderrPath
    },
    repair
  };
  const runPath = join(runDir, "run.json");
  await writeJson(runPath, record);

  return {
    ...record,
    runPath
  };
}
