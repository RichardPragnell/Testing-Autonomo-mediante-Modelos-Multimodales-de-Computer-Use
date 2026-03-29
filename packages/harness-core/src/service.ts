import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { describeBenchmarkTarget, listBenchmarkTargets } from "./config/target.js";
import { loadProjectEnv } from "./env/load.js";
import { loadAppBenchmark } from "./experiments/benchmark.js";
import { persistComparisonReport } from "./experiments/comparison.js";
import { buildResolvedSuite, executeGuidedTasks, readCandidateFileSnippets } from "./experiments/common.js";
import { compareExploreRuns, getExploreReport, runExploreExperiment } from "./experiments/explore.js";
import { compareHealRuns, getHealReport, runHealExperiment } from "./experiments/heal.js";
import { compareQaRuns, getQaReport, runQaExperiment } from "./experiments/qa.js";
import type {
  AppBenchmarkManifest,
  BenchmarkComparisonReport,
  CompareResult,
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

async function compareByKind(
  kind: BenchmarkRunKind,
  runIds: string[],
  resultsDir: string
): Promise<CompareResult<BenchmarkReport>> {
  if (kind === "qa") {
    return (await compareQaRuns(runIds, resultsDir)) as CompareResult<BenchmarkReport>;
  }
  if (kind === "explore") {
    return (await compareExploreRuns(runIds, resultsDir)) as CompareResult<BenchmarkReport>;
  }
  return (await compareHealRuns(runIds, resultsDir)) as CompareResult<BenchmarkReport>;
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

  const suite = await resolveSuiteManifest(input.suitePath);
  const resultsDir = input.resultsDir ?? "results";
  const qa = await runQaExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.qaRunner
  });
  const explore = await runExploreExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.exploreRunner
  });
  const heal = await runHealExperiment({
    appId: suite.appId,
    modelsPath: input.modelsPath,
    resultsDir,
    runner: input.healRunner,
    repairClient: input.repairClient
  });
  const comparison = await compareBenchmarkRuns(
    [qa.artifact.runId, explore.artifact.runId, heal.artifact.runId],
    resultsDir
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
    [...grouped.entries()].map(async ([kind, kindRunIds]) => [kind, await compareByKind(kind, kindRunIds, resultsDir)] as const)
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
