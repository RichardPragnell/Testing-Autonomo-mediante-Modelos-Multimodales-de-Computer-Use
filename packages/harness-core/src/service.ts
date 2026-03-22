import { randomUUID } from "node:crypto";
import { loadBenchmarkSuite, listBenchmarkSuites } from "./config/suite.js";
import { describeBenchmarkTarget, listBenchmarkTargets, resolveTargetSelections } from "./config/target.js";
import { loadModelRegistry, resolveModelAvailability } from "./config/model-registry.js";
import { loadPromptText } from "./config/prompt.js";
import { buildModelMetrics } from "./benchmark/score.js";
import { buildSourceCandidates } from "./diagnostics/source-candidates.js";
import { loadProjectEnv } from "./env/load.js";
import { classifyFailure } from "./diagnostics/taxonomy.js";
import { matchActionCache, resolveExplorationCompatibility } from "./exploration/action-cache.js";
import { CoverageGraph } from "./graph/state-graph.js";
import {
  persistExplorationArtifact,
  persistRepairAttempt,
  persistReport,
  persistRunArtifact,
  persistRunExplorationArtifacts,
  persistRunManifest,
  persistTaskArtifacts,
  readExplorationArtifact,
  readReport,
  readRunArtifact
} from "./persistence/store.js";
import { buildBenchmarkReport } from "./reporting/report.js";
import { StagehandAutomationRunner } from "./runner/stagehand-runner.js";
import { runAgentForPatch } from "./self-heal/adapter.js";
import { applyPatchInIsolatedWorktree } from "./self-heal/worktree.js";
import { startAut } from "./runtime/aut.js";
import { prepareRunWorkspace } from "./runtime/workspace.js";
import { getNextStep, getPlanStatus, updatePlanStep } from "./tracking/plan.js";
import { nowIso } from "./utils/time.js";
import { resolveWorkspacePath } from "./utils/fs.js";
import type {
  ActionCacheEntry,
  AutomationRunner,
  BenchmarkExplorationSummary,
  BenchmarkReport,
  BenchmarkSuite,
  ExploreTargetInput,
  ExploreTargetResult,
  ExplorationArtifact,
  ExplorationCacheUsage,
  Finding,
  ModelAvailability,
  ModelRunSummary,
  RepairAttempt,
  ResolvedBenchmarkSuite,
  RunArtifact,
  RunBenchmarkInput,
  RunBenchmarkResult,
  RunGuidedInput,
  RunGuidedResult,
  RunWorkspace,
  TaskRunResult
} from "./types.js";

function severityFromCategory(category: ReturnType<typeof classifyFailure>): "low" | "medium" | "high" {
  if (category === "timeout" || category === "navigation") {
    return "high";
  }
  if (category === "assertion" || category === "locator") {
    return "medium";
  }
  return "low";
}

function buildRunConfig(suite: Pick<BenchmarkSuite, "timeoutMs" | "retryCount" | "maxSteps" | "viewport">) {
  return {
    timeoutMs: suite.timeoutMs,
    retryCount: suite.retryCount,
    maxSteps: suite.maxSteps,
    viewport: suite.viewport
  };
}

function toExplorationSummary(artifact: ExplorationArtifact): BenchmarkExplorationSummary {
  return {
    explorationRunId: artifact.explorationRunId,
    modelId: artifact.modelId,
    trial: artifact.trial,
    ...artifact.summary
  };
}

function buildFindings(input: {
  runId: string;
  modelId: string;
  trial: number;
  workspacePath: string;
  resolvedSuite: ResolvedBenchmarkSuite;
  task: ResolvedBenchmarkSuite["tasks"][number];
  result: TaskRunResult;
}) {
  if (input.result.success) {
    return [];
  }

  const reason = input.result.error ?? input.result.message;
  const category = classifyFailure(reason);
  return [
    {
      id: randomUUID(),
      runId: input.runId,
      modelId: input.modelId,
      taskId: input.task.id,
      trial: input.trial,
      severity: severityFromCategory(category),
      category,
      message: reason,
      artifacts: {},
      sourceCandidates: buildSourceCandidates({
        workspacePath: input.workspacePath,
        suite: input.resolvedSuite,
        task: input.task,
        result: input.result,
        category,
        message: reason
      }),
      createdAt: nowIso()
    } satisfies Finding
  ];
}

function defaultRuntimeConfig(input: {
  timeoutMs?: number;
  retryCount?: number;
  maxSteps?: number;
  viewport?: {
    width: number;
    height: number;
  };
}) {
  return {
    timeoutMs: input.timeoutMs ?? 60_000,
    retryCount: input.retryCount ?? 1,
    maxSteps: input.maxSteps ?? 20,
    viewport: input.viewport ?? { width: 1280, height: 720 }
  };
}

async function loadResultsRoot(pathLike?: string): Promise<string> {
  return resolveWorkspacePath(pathLike ?? "results");
}

async function loadRegistry(modelsPath?: string) {
  const resolvedModelsPath = await resolveWorkspacePath(modelsPath ?? "experiments/models/registry.yaml");
  return loadModelRegistry(resolvedModelsPath);
}

function resolveRuntimeModel(registry: Awaited<ReturnType<typeof loadModelRegistry>>, modelId?: string): ModelAvailability {
  const requested = modelId ? [modelId] : [registry.defaultModel];
  const models = resolveModelAvailability(registry, requested);
  const selected = models[0];
  if (!selected) {
    throw new Error(`model ${requested[0]} not found in registry`);
  }
  if (!selected.available) {
    throw new Error(selected.reason ?? `model ${selected.id} is not available`);
  }
  return selected;
}

async function buildRuntimeResolvedSuite(input: {
  suiteId: string;
  targetId: string;
  scenarioIds: string[];
  bugIds: string[];
  explorationMode: "guided" | "autonomous";
  guidedPromptId?: string;
  autonomousPromptText?: string;
  resultsDir: string;
  timeoutMs?: number;
  retryCount?: number;
  maxSteps?: number;
  viewport?: {
    width: number;
    height: number;
  };
}): Promise<ResolvedBenchmarkSuite> {
  if (input.scenarioIds.length > 0) {
    return loadBenchmarkSuite({
      suite: {
        suiteId: input.suiteId,
        targetId: input.targetId,
        scenarioIds: input.scenarioIds,
        bugIds: input.bugIds,
        explorationMode: input.explorationMode,
        promptIds: {
          guided: input.guidedPromptId
        },
        trials: 1,
        ...defaultRuntimeConfig(input),
        seed: 1,
        resultsDir: input.resultsDir
      }
    });
  }

  const target = await resolveTargetSelections({
    targetId: input.targetId,
    scenarioIds: [],
    bugIds: input.bugIds
  });

  return {
    suitePath: "",
    suite: {
      suiteId: input.suiteId,
      targetId: input.targetId,
      scenarioIds: [],
      bugIds: input.bugIds,
      explorationMode: input.explorationMode,
      promptIds: {},
      trials: 1,
      ...defaultRuntimeConfig(input),
      seed: 1,
      resultsDir: input.resultsDir
    },
    target,
    selectedScenarios: [],
    selectedBugs: target.bugs,
    tasks: [],
    prompts: {
      guided: input.guidedPromptId ? await loadPromptText(input.guidedPromptId) : undefined,
      autonomous: input.autonomousPromptText,
      repair: undefined
    }
  };
}

function resolveTaskCacheHints(input: {
  explorationArtifact?: ExplorationArtifact;
  taskInstruction: string;
  autUrl: string;
}): ActionCacheEntry[] {
  if (!input.explorationArtifact) {
    return [];
  }

  const rootStateId =
    input.explorationArtifact.pages.find((page) => page.url === input.autUrl)?.id ??
    input.explorationArtifact.pages[0]?.id;

  return matchActionCache({
    cache: input.explorationArtifact.actionCache,
    instruction: input.taskInstruction,
    stateId: rootStateId,
    limit: 3
  });
}

async function runGuidedTasks(input: {
  runId: string;
  resultsRoot: string;
  resolvedSuite: ResolvedBenchmarkSuite;
  workspace: RunWorkspace;
  model: ModelAvailability;
  runner: AutomationRunner;
  trial: number;
  coverageGraph: CoverageGraph;
  explorationArtifact?: ExplorationArtifact;
  guidedCacheUsage?: ExplorationCacheUsage;
}) {
  const taskRuns: TaskRunResult[] = [];
  const findings: Finding[] = [];
  let previousState = input.coverageGraph.upsertState({ url: input.workspace.aut.url });

  for (const task of input.resolvedSuite.tasks) {
    const cacheHints = resolveTaskCacheHints({
      explorationArtifact: input.explorationArtifact,
      taskInstruction: task.instruction,
      autUrl: input.workspace.aut.url
    });

    const result = await input.runner.runTask({
      model: input.model,
      task,
      trial: input.trial,
      aut: input.workspace.aut,
      runConfig: buildRunConfig(input.resolvedSuite.suite),
      systemPrompt: input.resolvedSuite.prompts.guided,
      cacheHints
    });

    if (input.guidedCacheUsage && !input.guidedCacheUsage.compatible) {
      result.trace.unshift({
        timestamp: nowIso(),
        action: "cache.mismatch",
        details: {
          explorationRunId: input.guidedCacheUsage.explorationRunId,
          reason: input.guidedCacheUsage.reason
        }
      });
    } else if (cacheHints.length > 0) {
      result.trace.unshift({
        timestamp: nowIso(),
        action: "cache.hints",
        details: {
          explorationRunId: input.explorationArtifact?.explorationRunId,
          actionIds: cacheHints.map((entry) => entry.actionId)
        }
      });
    }

    taskRuns.push(result);

    const nextState = input.coverageGraph.upsertState({
      url: result.urlAfter ?? input.workspace.aut.url,
      domSnapshot: result.domSnapshot,
      screenshotBase64: result.screenshotBase64
    });
    input.coverageGraph.addTransition(previousState, nextState, task.instruction);
    previousState = nextState;

    const artifactRefs = await persistTaskArtifacts(input.resultsRoot, input.runId, input.model.id, result);
    const taskFindings = buildFindings({
      runId: input.runId,
      modelId: input.model.id,
      trial: input.trial,
      workspacePath: input.workspace.workspacePath,
      resolvedSuite: input.resolvedSuite,
      task,
      result
    });

    for (const finding of taskFindings) {
      finding.artifacts = artifactRefs;
      findings.push(finding);
    }
  }

  return { taskRuns, findings };
}

async function maybeRunAutonomousExploration(input: {
  explorationMode: "guided" | "autonomous";
  runner: AutomationRunner;
  runId: string;
  resultsRoot: string;
  resolvedSuite: ResolvedBenchmarkSuite;
  workspace: RunWorkspace;
  model: ModelAvailability;
  trial: number;
}): Promise<{
  artifact?: ExplorationArtifact;
  summary?: BenchmarkExplorationSummary;
}> {
  if (input.explorationMode !== "autonomous" || typeof input.runner.exploreTarget !== "function") {
    return {};
  }

  const prompt =
    input.resolvedSuite.prompts.autonomous ??
    "Autonomously explore the app, discover useful UI paths, and avoid repeating the same action on equivalent states.";

  const artifact = await input.runner.exploreTarget({
    model: input.model,
    trial: input.trial,
    targetId: input.resolvedSuite.suite.targetId,
    bugIds: input.resolvedSuite.suite.bugIds,
    prompt,
    aut: input.workspace.aut,
    runConfig: buildRunConfig(input.resolvedSuite.suite),
    workspacePath: input.workspace.workspacePath
  });

  await persistRunExplorationArtifacts(input.resultsRoot, input.runId, artifact);
  return {
    artifact,
    summary: toExplorationSummary(artifact)
  };
}

async function finalizeRun(input: {
  runId: string;
  resultsRoot: string;
  resolvedSuite: ResolvedBenchmarkSuite;
  workspace: RunWorkspace;
  startedAt: string;
  modelSummaries: ModelRunSummary[];
  findings: Finding[];
  repairs: RepairAttempt[];
  coverageGraph: CoverageGraph;
  autonomousExploration?: BenchmarkExplorationSummary[];
  guidedCacheUsage?: ExplorationCacheUsage;
}): Promise<RunBenchmarkResult> {
  const finishedAt = nowIso();
  const artifact: RunArtifact = {
    runId: input.runId,
    suiteId: input.resolvedSuite.suite.suiteId,
    targetId: input.resolvedSuite.suite.targetId,
    scenarioIds: input.resolvedSuite.suite.scenarioIds,
    bugIds: input.resolvedSuite.suite.bugIds,
    explorationMode: input.resolvedSuite.suite.explorationMode,
    workspacePath: input.workspace.workspacePath,
    startedAt: input.startedAt,
    finishedAt,
    suiteSnapshot: input.resolvedSuite,
    modelSummaries: input.modelSummaries,
    findings: input.findings,
    coverageGraph: input.coverageGraph.snapshot(),
    autonomousExploration: input.autonomousExploration,
    guidedCacheUsage: input.guidedCacheUsage
  };

  const artifactPath = await persistRunArtifact(input.resultsRoot, artifact);
  await persistRunManifest(input.resultsRoot, artifact);

  const report: BenchmarkReport = buildBenchmarkReport({
    runId: input.runId,
    suiteId: input.resolvedSuite.suite.suiteId,
    targetId: input.resolvedSuite.suite.targetId,
    scenarioIds: input.resolvedSuite.suite.scenarioIds,
    bugIds: input.resolvedSuite.suite.bugIds,
    explorationMode: input.resolvedSuite.suite.explorationMode,
    modelSummaries: input.modelSummaries,
    findings: input.findings,
    autonomousExploration: input.autonomousExploration,
    guidedCacheUsage: input.guidedCacheUsage,
    repairs: input.repairs
  });
  const reportPath = await persistReport(input.resultsRoot, report);

  return {
    artifact,
    report,
    artifactPath,
    reportPath
  };
}

export async function runBenchmarkSuite(input: RunBenchmarkInput): Promise<RunBenchmarkResult> {
  await loadProjectEnv();

  const resolvedSuite = await loadBenchmarkSuite({
    suitePath: input.suitePath,
    suite: input.suite
  });

  const modelsPath = await resolveWorkspacePath(input.modelsPath ?? "experiments/models/registry.yaml");
  const resultsRoot = await resolveWorkspacePath(input.reportsDir ?? resolvedSuite.suite.resultsDir);
  const registry = await loadModelRegistry(modelsPath);
  const models = resolveModelAvailability(registry, resolvedSuite.suite.models);
  const runner = input.runner ?? new StagehandAutomationRunner();
  const runId = `${resolvedSuite.suite.suiteId}-${Date.now()}`;
  const startedAt = nowIso();
  const coverageGraph = new CoverageGraph();
  const findings: Finding[] = [];
  const modelSummaries: ModelRunSummary[] = [];
  const repairs: RepairAttempt[] = [];
  const autonomousExploration: BenchmarkExplorationSummary[] = [];
  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });

  const autHandle = await startAut(workspace.aut).catch((error) => {
    throw new Error(`failed to start benchmark target: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    for (const model of models) {
      if (!model.available) {
        modelSummaries.push({
          model,
          metrics: buildModelMetrics(model.id, [], resolvedSuite.tasks.length * resolvedSuite.suite.trials),
          taskRuns: []
        });
        continue;
      }

      const taskRuns: TaskRunResult[] = [];
      for (let trial = 1; trial <= resolvedSuite.suite.trials; trial += 1) {
        const exploration = await maybeRunAutonomousExploration({
          explorationMode: resolvedSuite.suite.explorationMode,
          runner,
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          trial
        });
        if (exploration.summary) {
          autonomousExploration.push(exploration.summary);
        }

        const trialResults = await runGuidedTasks({
          runId,
          resultsRoot,
          resolvedSuite,
          workspace,
          model,
          runner,
          trial,
          coverageGraph,
          explorationArtifact: exploration.artifact
        });
        taskRuns.push(...trialResults.taskRuns);
        findings.push(...trialResults.findings);
      }

      modelSummaries.push({
        model,
        metrics: buildModelMetrics(model.id, taskRuns, 0),
        taskRuns
      });
    }
  } finally {
    await autHandle?.stop();
  }

  return finalizeRun({
    runId,
    resultsRoot,
    resolvedSuite,
    workspace,
    startedAt,
    modelSummaries,
    findings,
    repairs,
    coverageGraph,
    autonomousExploration
  });
}

export async function exploreTarget(input: ExploreTargetInput): Promise<ExploreTargetResult> {
  await loadProjectEnv();

  const resultsRoot = await loadResultsRoot(input.resultsDir);
  const registry = await loadRegistry(input.modelsPath);
  const model = resolveRuntimeModel(registry, input.modelId);
  const runner = input.runner ?? new StagehandAutomationRunner();
  if (typeof runner.exploreTarget !== "function") {
    throw new Error("selected automation runner does not support autonomous exploration");
  }

  const resolvedSuite = await buildRuntimeResolvedSuite({
    suiteId: `explore-${input.targetId}`,
    targetId: input.targetId,
    scenarioIds: [],
    bugIds: input.bugIds ?? [],
    explorationMode: "autonomous",
    autonomousPromptText: input.prompt,
    resultsDir: resultsRoot,
    timeoutMs: input.timeoutMs,
    retryCount: input.retryCount,
    maxSteps: input.maxSteps,
    viewport: input.viewport
  });

  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId: `explore-${Date.now()}`,
    resultsRoot
  });

  const autHandle = await startAut(workspace.aut).catch((error) => {
    throw new Error(`failed to start benchmark target: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    const artifact = await runner.exploreTarget({
      model,
      trial: 1,
      targetId: input.targetId,
      bugIds: input.bugIds ?? [],
      prompt: input.prompt,
      aut: workspace.aut,
      runConfig: buildRunConfig(resolvedSuite.suite),
      workspacePath: workspace.workspacePath
    });
    const artifactPath = await persistExplorationArtifact(resultsRoot, artifact);
    return { artifact, artifactPath };
  } finally {
    await autHandle?.stop();
  }
}

export async function runGuided(input: RunGuidedInput): Promise<RunGuidedResult> {
  await loadProjectEnv();

  const resultsRoot = await loadResultsRoot(input.resultsDir);
  const registry = await loadRegistry(input.modelsPath);
  const model = resolveRuntimeModel(registry, input.modelId);
  const runner = input.runner ?? new StagehandAutomationRunner();
  const runId = `guided-${input.targetId}-${Date.now()}`;
  const startedAt = nowIso();
  const coverageGraph = new CoverageGraph();

  const resolvedSuite = await buildRuntimeResolvedSuite({
    suiteId: runId,
    targetId: input.targetId,
    scenarioIds: input.scenarioIds,
    bugIds: input.bugIds ?? [],
    explorationMode: "guided",
    guidedPromptId: input.guidedPromptId ?? "guided.default",
    resultsDir: resultsRoot,
    timeoutMs: input.timeoutMs,
    retryCount: input.retryCount,
    maxSteps: input.maxSteps,
    viewport: input.viewport
  });

  const workspace = await prepareRunWorkspace({
    resolvedSuite,
    runId,
    resultsRoot
  });

  let guidedCacheUsage: ExplorationCacheUsage | undefined;
  let explorationArtifact: ExplorationArtifact | undefined;
  if (input.explorationRunId) {
    try {
      const artifact = await readExplorationArtifact(resultsRoot, input.explorationRunId);
      const compatibility = resolveExplorationCompatibility({
        artifact,
        targetId: input.targetId,
        bugIds: input.bugIds ?? [],
        viewport: resolvedSuite.suite.viewport
      });
      guidedCacheUsage = compatibility;
      explorationArtifact = compatibility.compatible ? artifact : undefined;
    } catch (error) {
      guidedCacheUsage = {
        explorationRunId: input.explorationRunId,
        compatible: false,
        reason: error instanceof Error ? error.message : String(error),
        matchedActions: 0
      };
    }
  }

  const autHandle = await startAut(workspace.aut).catch((error) => {
    throw new Error(`failed to start benchmark target: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    const trialResults = await runGuidedTasks({
      runId,
      resultsRoot,
      resolvedSuite,
      workspace,
      model,
      runner,
      trial: 1,
      coverageGraph,
      explorationArtifact,
      guidedCacheUsage
    });

    const modelSummaries: ModelRunSummary[] = [
      {
        model,
        metrics: buildModelMetrics(model.id, trialResults.taskRuns, 0),
        taskRuns: trialResults.taskRuns
      }
    ];

    return finalizeRun({
      runId,
      resultsRoot,
      resolvedSuite,
      workspace,
      startedAt,
      modelSummaries,
      findings: trialResults.findings,
      repairs: [],
      coverageGraph,
      guidedCacheUsage
    });
  } finally {
    await autHandle?.stop();
  }
}

export async function getBenchmarkReport(runId: string, resultsRoot = "results"): Promise<BenchmarkReport> {
  const resolvedResultsRoot = await resolveWorkspacePath(resultsRoot);
  return readReport(resolvedResultsRoot, runId);
}

export async function compareBenchmarkRuns(runIds: string[], resultsRoot = "results"): Promise<{
  reports: BenchmarkReport[];
  aggregateLeaderboard: Array<{ modelId: string; avgScore: number; runs: number }>;
}> {
  const reports = await Promise.all(runIds.map((runId) => getBenchmarkReport(runId, resultsRoot)));
  const scoreMap = new Map<string, number[]>();
  for (const report of reports) {
    for (const item of report.leaderboard) {
      const current = scoreMap.get(item.modelId) ?? [];
      current.push(item.score);
      scoreMap.set(item.modelId, current);
    }
  }
  const aggregateLeaderboard = [...scoreMap.entries()]
    .map(([modelId, scores]) => ({
      modelId,
      avgScore: Number((scores.reduce((acc, value) => acc + value, 0) / scores.length).toFixed(3)),
      runs: scores.length
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return { reports, aggregateLeaderboard };
}

export async function runSelfHeal(input: {
  runId: string;
  findingId: string;
  agentCommand: string;
  validationCommand?: string;
  outputDir?: string;
  cwd?: string;
}): Promise<RepairAttempt> {
  await loadProjectEnv();

  const resultsRoot = await resolveWorkspacePath(input.outputDir ?? "results");
  const artifact = await readRunArtifact(resultsRoot, input.runId);
  const finding = artifact.findings.find((item) => item.id === input.findingId);
  const attemptId = `repair-${Date.now()}`;

  if (!finding) {
    const missingAttempt: RepairAttempt = {
      attemptId,
      runId: input.runId,
      findingId: input.findingId,
      outcome: "skipped",
      note: `finding ${input.findingId} not found in run ${input.runId}`,
      createdAt: nowIso()
    };
    await persistRepairAttempt(resultsRoot, input.runId, missingAttempt);
    return missingAttempt;
  }

  const patchContext = {
    runId: artifact.runId,
    suiteId: artifact.suiteId,
    targetId: artifact.targetId,
    bugIds: artifact.bugIds,
    finding,
    suiteSnapshot: artifact.suiteSnapshot,
    repairPrompt: artifact.suiteSnapshot.prompts.repair
  };
  const patchResult = await runAgentForPatch({
    command: input.agentCommand,
    context: patchContext,
    cwd: input.cwd ?? artifact.workspacePath
  });

  if (!patchResult.patch) {
    const noPatch: RepairAttempt = {
      attemptId,
      runId: input.runId,
      findingId: input.findingId,
      outcome: "not_fixed",
      note: `agent produced no valid unified diff (exit ${patchResult.exitCode})`,
      createdAt: nowIso()
    };
    await persistRepairAttempt(resultsRoot, input.runId, noPatch);
    return noPatch;
  }

  const worktreeResult = await applyPatchInIsolatedWorktree({
    cwd: artifact.workspacePath,
    patch: patchResult.patch,
    validationCommand:
      input.validationCommand ??
      artifact.suiteSnapshot.selectedBugs.find((bug) => bug.validationCommand)?.validationCommand ??
      artifact.suiteSnapshot.target.target.defaultValidationCommand,
    attemptId
  });

  const attempt: RepairAttempt = {
    attemptId,
    runId: input.runId,
    findingId: input.findingId,
    outcome: worktreeResult.outcome,
    note: worktreeResult.note,
    patchPath: worktreeResult.patchPath,
    validationExitCode: worktreeResult.validationExitCode,
    createdAt: nowIso()
  };
  await persistRepairAttempt(resultsRoot, input.runId, attempt);
  return attempt;
}

export function listTargets(): Promise<Awaited<ReturnType<typeof listBenchmarkTargets>>> {
  return listBenchmarkTargets();
}

export function listSuites(): Promise<Awaited<ReturnType<typeof listBenchmarkSuites>>> {
  return listBenchmarkSuites();
}

export function describeTarget(targetId: string): Promise<Awaited<ReturnType<typeof describeBenchmarkTarget>>> {
  return describeBenchmarkTarget(targetId);
}

export const runExperiment = runBenchmarkSuite;
export const getReport = getBenchmarkReport;
export const compareModels = compareBenchmarkRuns;

export function planStatus(): Promise<Awaited<ReturnType<typeof getPlanStatus>>> {
  return getPlanStatus();
}

export function planUpdate(input: {
  stepId: string;
  status: "not_started" | "in_progress" | "blocked" | "done" | "verified";
  note: string;
  evidence: string[];
}): Promise<Awaited<ReturnType<typeof updatePlanStep>>> {
  return updatePlanStep(input);
}

export function planNext(): Promise<Awaited<ReturnType<typeof getNextStep>>> {
  return getNextStep();
}
