import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { describeBenchmarkTarget, listBenchmarkTargets } from "./config/target.js";
import { loadProjectEnv } from "./env/load.js";
import { loadAppBenchmark } from "./experiments/benchmark.js";
import { persistComparisonReport } from "./experiments/comparison.js";
import {
  buildResolvedSuite,
  emitExperimentLog,
  executeGuidedTasks,
  formatDurationMs,
  readCandidateFileSnippets
} from "./experiments/common.js";
import {
  buildExploreComparison,
  compareExploreRuns,
  getExploreReport,
  runExploreExperiment,
  type RunExploreExperimentInput
} from "./experiments/explore.js";
import {
  buildHealComparison,
  compareHealRuns,
  getHealReport,
  runHealExperiment,
  type RunHealExperimentInput
} from "./experiments/heal.js";
import { buildQaComparison, compareQaRuns, getQaReport, runQaExperiment, type RunQaExperimentInput } from "./experiments/qa.js";
import type {
  AppBenchmarkManifest,
  BenchmarkComparisonProvenance,
  BenchmarkComparisonProvenanceEntry,
  BenchmarkComparisonReport,
  CompareResult,
  ExperimentKind,
  ExperimentLogFn,
  ExploreReport,
  HealReport,
  QaReport
} from "./experiments/types.js";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "./cache/config.js";
import { summarizeTaskRunCache } from "./cache/summary.js";
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
  StagehandRunConfig,
  TaskRunResult
} from "./types.js";
import { ensureDir, readText, resolveWorkspacePath, writeJson, writeText } from "./utils/fs.js";
import { nowIso } from "./utils/time.js";

type BenchmarkRunKind = "qa" | "explore" | "heal";
type BenchmarkReport = QaReport | ExploreReport | HealReport;

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
  cacheSummary?: ReturnType<typeof summarizeTaskRunCache>;
  taskRuns: TaskRunResult[];
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
  cacheSummary?: ReturnType<typeof summarizeTaskRunCache>;
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
}

export interface RunExploreAcrossAppsInput extends Omit<RunExploreExperimentInput, "appId"> {
  appsRoot?: string;
}

export interface RunHealAcrossAppsInput extends Omit<RunHealExperimentInput, "appId"> {
  appsRoot?: string;
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
}

export interface RebuildBenchmarkReportsResult {
  selectionPolicy: "latest-per-app-mode";
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

async function resolveRuntimeRoot(
  resultsDir: string,
  kind: RuntimeGuidedRunRecord["kind"] | RuntimeExploreRunRecord["kind"] | RuntimeHealRunRecord["kind"]
): Promise<string> {
  return join(await resolveWorkspacePath(resultsDir), kind);
}

function summarizeTaskRuns(taskRuns: TaskRunResult[]) {
  return {
    total: taskRuns.length,
    passed: taskRuns.filter((taskRun) => taskRun.success).length,
    failed: taskRuns.filter((taskRun) => !taskRun.success).length,
    cacheSummary: summarizeTaskRunCache(taskRuns)
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
    candidates.find((candidate) => candidate.id === registry.defaultModel && candidate.available) ??
    candidates.find((candidate) => candidate.available) ??
    candidates.find((candidate) => candidate.id === registry.defaultModel) ??
    candidates[0];

  if (!preferred) {
    throw new Error(`no models configured in ${registryPath}`);
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

function scenarioTaskIds(
  input: {
    targetId: string;
    scenarioIds: string[];
  },
  scenarios: Awaited<ReturnType<typeof describeBenchmarkTarget>>["scenarios"]
): string[] {
  const scenarioMap = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const taskIds: string[] = [];

  for (const scenarioId of input.scenarioIds) {
    const scenario = scenarioMap.get(scenarioId);
    if (!scenario) {
      throw new Error(`unknown scenario ${scenarioId} for target ${input.targetId}`);
    }
    for (const task of scenario.tasks) {
      if (!taskIds.includes(task.id)) {
        taskIds.push(task.id);
      }
    }
  }

  return taskIds;
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
  reports: BenchmarkReport[]
): Pick<CompareResult<BenchmarkReport>, "aggregateLeaderboard" | "modeSection"> {
  if (kind === "qa") {
    return buildQaComparison(reports as QaReport[]);
  }
  if (kind === "explore") {
    return buildExploreComparison(reports as ExploreReport[]);
  }
  return buildHealComparison(reports as HealReport[]);
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
      prefix: "qa-compare"
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

function reportTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortSelections<T extends {
  kind: ExperimentKind;
  appId: string;
  runId: string;
}>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    return (
      left.kind.localeCompare(right.kind) ||
      left.appId.localeCompare(right.appId) ||
      left.runId.localeCompare(right.runId)
    );
  });
}

type LatestBenchmarkReportRecord = {
  kind: BenchmarkRunKind;
  report: BenchmarkReport;
  reportPath: string;
};

type SelectedBenchmarkReportRecord = LatestBenchmarkReportRecord & {
  appId: string;
  generatedAt: string;
  runId: string;
};

async function listBenchmarkRunReports(
  kind: BenchmarkRunKind,
  resultsDir: string
): Promise<LatestBenchmarkReportRecord[]> {
  const reportsDir = join(await resolveWorkspacePath(resultsDir), kind, "reports");
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
      const report = await readJsonFile<BenchmarkReport>(reportPath);
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

function selectLatestBenchmarkReports(records: LatestBenchmarkReportRecord[]): SelectedBenchmarkReportRecord[] {
  const latestByApp = new Map<string, SelectedBenchmarkReportRecord>();
  for (const record of records) {
    const candidate: SelectedBenchmarkReportRecord = {
      ...record,
      appId: record.report.appId,
      generatedAt: record.report.generatedAt,
      runId: record.report.runId
    };
    const current = latestByApp.get(candidate.appId);
    if (!current) {
      latestByApp.set(candidate.appId, candidate);
      continue;
    }

    const freshness =
      reportTimestamp(candidate.generatedAt) - reportTimestamp(current.generatedAt) ||
      candidate.runId.localeCompare(current.runId);
    if (freshness > 0) {
      latestByApp.set(candidate.appId, candidate);
    }
  }

  return sortSelections([...latestByApp.values()]);
}

function toProvenance(
  selectedReports: RebuiltBenchmarkReportSelection[],
  note: string
): BenchmarkComparisonProvenance {
  return {
    selectionPolicy: "latest-per-app-mode",
    note,
    selectedReports: sortSelections(
      selectedReports.map<BenchmarkComparisonProvenanceEntry>((entry) => ({
        kind: entry.kind,
        appId: entry.appId,
        runId: entry.runId,
        generatedAt: entry.generatedAt,
        reportPath: entry.reportPath
      }))
    )
  };
}

async function persistModeComparisonForReports(
  kind: BenchmarkRunKind,
  reports: BenchmarkReport[],
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
  const finalReport = await persistComparisonReport({
    title: config.title,
    subtitle: `Matrix comparison across ${reports.length} ${config.subtitleNoun} run(s).`,
    runIds: reports.map((report) => report.runId),
    modeSections: [built.modeSection],
    resultsDir,
    prefix: config.prefix,
    provenance
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
  onLog?: ExperimentLogFn;
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
  emitExperimentLog(
    input.onLog,
    `[${input.mode}] Starting multi-app run across ${appIds.length} app(s): ${appIds.join(", ")}`
  );

  const runs: MultiAppExperimentRunEntry[] = [];
  for (const [appIndex, appId] of appIds.entries()) {
    emitExperimentLog(
      input.onLog,
      `[${input.mode}] App ${appIndex + 1}/${appIds.length} ${appId}: started`
    );
    const result = await input.runForApp(appId);
    runs.push({
      appId,
      runId: result.artifact.runId,
      artifactPath: result.artifactPath,
      reportPath: result.reportPath,
      htmlPath: result.htmlPath
    });
    emitExperimentLog(
      input.onLog,
      `[${input.mode}] App ${appIndex + 1}/${appIds.length} ${appId}: completed (${result.artifact.runId})`
    );
  }

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
      qa: benchmark.benchmark.qa,
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
  const multiRun = await runExperimentAcrossApps({
    mode: "qa",
    appsRoot: input.appsRoot,
    onLog: input.onLog,
    runForApp: async (appId) =>
      runQaExperiment({
        appId,
        profile: input.profile,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        timeoutMs: input.timeoutMs,
        retryCount: input.retryCount,
        maxSteps: input.maxSteps,
        maxOutputTokens: input.maxOutputTokens,
        viewport: input.viewport,
        resultsDir,
        runner: input.runner,
        onLog: input.onLog
      }),
    compare: (runIds) => compareQaRuns(runIds, resultsDir)
  });

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
  const multiRun = await runExperimentAcrossApps({
    mode: "explore",
    appsRoot: input.appsRoot,
    onLog: input.onLog,
    runForApp: async (appId) =>
      runExploreExperiment({
        appId,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        resultsDir,
        runner: input.runner,
        onLog: input.onLog
      }),
    compare: (runIds) => compareExploreRuns(runIds, resultsDir)
  });

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
  const multiRun = await runExperimentAcrossApps({
    mode: "heal",
    appsRoot: input.appsRoot,
    onLog: input.onLog,
    runForApp: async (appId) =>
      runHealExperiment({
        appId,
        models: input.models,
        modelsPath: input.modelsPath,
        presetPath: input.presetPath,
        trials: input.trials,
        resultsDir,
        runner: input.runner,
        repairClient: input.repairClient,
        onLog: input.onLog
      }),
    compare: (runIds) => compareHealRuns(runIds, resultsDir)
  });

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
      throw new Error(`comparison only supports benchmark run ids (qa-, explore-, heal-); got ${runId}`);
    }
    grouped.set(kind, [...(grouped.get(kind) ?? []), runId]);
  }

  const comparisons = await Promise.all(
    [...grouped.entries()].map(async ([kind, kindRunIds]) => {
      const reports = await Promise.all(kindRunIds.map((runId) => getBenchmarkReportByKind(kind, runId, resultsDir)));
      return [kind, compareByKind(kind, reports)] as const;
    })
  );
  return persistComparisonReport({
    title: "Benchmark Final Report",
    subtitle: `Matrix comparison across ${runIds.length} benchmark run(s).`,
    runIds,
    modeSections: comparisons.map(([, comparison]) => comparison.modeSection),
    resultsDir,
    prefix: "benchmark-compare"
  });
}

export async function rebuildBenchmarkReports(
  input: RebuildBenchmarkReportsInput = {}
): Promise<RebuildBenchmarkReportsResult> {
  await loadProjectEnv();
  const resultsDir = input.resultsDir ?? "results";
  const requestedKinds = input.mode ? [input.mode] : (["qa", "explore", "heal"] as const);
  const selectedRecordsByKind = new Map<BenchmarkRunKind, SelectedBenchmarkReportRecord[]>();

  for (const kind of requestedKinds) {
    const records = await listBenchmarkRunReports(kind, resultsDir);
    const selected = selectLatestBenchmarkReports(records);
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

    const modeSelections = selectedReports.filter((item) => item.kind === kind);
    const rebuilt = await persistModeComparisonForReports(
      kind,
      selected.map((item) => item.report),
      resultsDir,
      toProvenance(
        modeSelections,
        "Rebuilt from the latest available report per app for this mode; report timestamps may differ across app cells."
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
    const finalReport = await persistComparisonReport({
      title: "Benchmark Final Report",
      subtitle: `Matrix comparison across ${selectedReports.length} benchmark run(s).`,
      runIds: selectedReports.map((item) => item.runId),
      modeSections,
      resultsDir,
      prefix: "benchmark-compare",
      provenance: toProvenance(
        selectedReports,
        "Rebuilt from the latest available report per mode and app; report timestamps may differ across sections."
      )
    });
    finalReportPath = finalReport.finalReportPath;
    finalJsonPath = finalReport.finalJsonPath;
  }

  return {
    selectionPolicy: "latest-per-app-mode",
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
    taskIds: benchmark.benchmark.explore.probeTaskIds,
    bugIds,
    explorationMode: "autonomous",
    suiteId: runId,
    resultsDir,
    runtime,
    promptIds: {
      guided: benchmark.benchmark.prompts.qa,
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
  const taskIds = scenarioTaskIds(input, benchmark.target.scenarios);
  const promptId = input.guidedPromptId ?? benchmark.benchmark.prompts.qa;
  const resolvedSuite = await buildResolvedSuite({
    resolvedBenchmark: benchmark,
    taskIds,
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
    const execution = await executeGuidedTasks({
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
      cacheSummary: summarizeTaskRunCache(execution.taskRuns),
      taskRuns: execution.taskRuns,
      findings: execution.findings
    };
    const runPath = join(resultsRoot, "runs", runId, "run.json");
    await writeJson(runPath, record);

    return {
      ...record,
      summary: summarizeTaskRuns(execution.taskRuns),
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
  const taskRuns = guidedRun.taskRuns.filter((taskRun) => taskRun.taskId === finding.taskId);
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
      taskRuns,
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
      attemptId: `${repairRunId}-${finding.taskId}`
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
