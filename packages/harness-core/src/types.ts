export type StepStatus = "not_started" | "in_progress" | "blocked" | "done" | "verified";

export interface PlanStep {
  stepId: string;
  goal: string;
  definitionOfDone: string;
  evidenceRequired: string;
  owner: string;
  status: StepStatus;
  lastUpdate: string;
}

export interface PlanSnapshot {
  path: string;
  steps: PlanStep[];
  blockers: PlanStep[];
}

export interface PlanUpdateInput {
  stepId: string;
  status: StepStatus;
  note: string;
  evidence: string[];
}

export interface PlanEvent {
  timestamp: string;
  type: "milestone" | "failure" | "retry" | "status_change";
  step_id?: string;
  status?: StepStatus;
  note: string;
  evidence: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelConfig {
  id: string;
  provider: string;
  envKey: string;
  enabled: boolean;
}

export interface ModelAvailability extends ModelConfig {
  available: boolean;
  reason?: string;
}

export interface ModelRegistry {
  defaultModel: string;
  models: ModelConfig[];
}

export type TaskExpectationType = "contains" | "url_contains" | "text_visible" | "text_not_visible";

export interface TaskExpectation {
  type: TaskExpectationType;
  value: string;
}

export type BenchmarkTaskSource = "synthetic" | "generated";

export interface BenchmarkTask {
  id: string;
  instruction: string;
  expected: TaskExpectation;
  source: BenchmarkTaskSource;
  scenarioId?: string;
}

export interface BenchmarkScenario {
  scenarioId: string;
  title: string;
  source: BenchmarkTaskSource;
  tasks: BenchmarkTask[];
}

export interface BugPackDefinition {
  bugId: string;
  title: string;
  description: string;
  category: FailureCategory;
  severity: "low" | "medium" | "high";
  patchPath: string;
  expectedFailureTaskIds: string[];
  validationCommand?: string;
}

export interface ResolvedBugPack extends BugPackDefinition {
  manifestPath: string;
  absolutePatchPath: string;
  touchedFiles: string[];
}

export interface BenchmarkTarget {
  targetId: string;
  displayName: string;
  baseUrl: string;
  devCommand: string;
  devEnv?: Record<string, string>;
  defaultValidationCommand: string;
  templateDir: string;
  bugsDir: string;
  scenariosDir: string;
}

export interface ResolvedBenchmarkTarget {
  manifestPath: string;
  rootDir: string;
  templatePath: string;
  target: BenchmarkTarget;
  scenarios: BenchmarkScenario[];
  bugs: ResolvedBugPack[];
}

export type ExplorationMode = "guided" | "autonomous";

export interface SuitePromptIds {
  guided?: string;
  autonomous?: string;
  repair?: string;
}

export interface BenchmarkSuite {
  suiteId: string;
  targetId: string;
  scenarioIds: string[];
  bugIds: string[];
  models?: string[];
  explorationMode: ExplorationMode;
  promptIds?: SuitePromptIds;
  trials: number;
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  viewport: {
    width: number;
    height: number;
  };
  seed: number;
  resultsDir: string;
}

export interface ResolvedPromptSet {
  guided?: string;
  autonomous?: string;
  repair?: string;
}

export interface ResolvedBenchmarkSuite {
  suitePath: string;
  suite: BenchmarkSuite;
  target: ResolvedBenchmarkTarget;
  selectedScenarios: BenchmarkScenario[];
  selectedBugs: ResolvedBugPack[];
  tasks: BenchmarkTask[];
  prompts: ResolvedPromptSet;
}

export interface RunWorkspace {
  workspacePath: string;
  templatePath: string;
  targetId: string;
  bugIds: string[];
  validationCommand: string;
  aut: AutConfig;
  baselineCommit: string;
  bugCommit: string;
}

export interface AutConfig {
  url: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface DiagnosisArtifacts {
  screenshotPath?: string;
  domSnapshotPath?: string;
  tracePath?: string;
}

export type FailureCategory =
  | "navigation"
  | "locator"
  | "state"
  | "assertion"
  | "timeout"
  | "unexpected_ui"
  | "unknown";

export interface Finding {
  id: string;
  runId: string;
  modelId: string;
  taskId: string;
  trial: number;
  severity: "low" | "medium" | "high";
  category: FailureCategory;
  message: string;
  artifacts: DiagnosisArtifacts;
  sourceCandidates: SourceCandidate[];
  createdAt: string;
}

export interface SourceCandidate {
  path: string;
  workspaceRelativePath: string;
  score: number;
  reasons: string[];
}

export interface OperationTrace {
  timestamp: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface StagehandHistoryEntry {
  method: string;
  parameters?: Record<string, unknown>;
  result?: unknown;
  timestamp: string;
}

export interface ObservedAction {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface ActionCacheEntry {
  actionId: string;
  stateId: string;
  url: string;
  domHash: string;
  visualHash: string;
  selector: string;
  description: string;
  method?: string;
  arguments: string[];
  signature: string;
  instructionHints: string[];
  observationCount: number;
  executionCount: number;
}

export interface ExplorationState {
  id: string;
  url: string;
  domHash: string;
  visualHash: string;
  summary: string;
  availableActions: ObservedAction[];
  visitCount: number;
}

export interface ExplorationCompatibility {
  targetId: string;
  bugIds: string[];
  viewport: {
    width: number;
    height: number;
  };
}

export interface ExplorationSummary {
  statesDiscovered: number;
  transitionsDiscovered: number;
  actionsCached: number;
  historyEntries: number;
}

export interface ExplorationCacheUsage {
  explorationRunId: string;
  compatible: boolean;
  reason?: string;
  matchedActions: number;
}

export interface ExplorationArtifact {
  explorationRunId: string;
  targetId: string;
  bugIds: string[];
  modelId: string;
  trial: number;
  prompt: string;
  workspacePath: string;
  startedAt: string;
  finishedAt: string;
  compatibility: ExplorationCompatibility;
  history: StagehandHistoryEntry[];
  pages: ExplorationState[];
  coverageGraph: CoverageGraphSnapshot;
  actionCache: ActionCacheEntry[];
  trace: OperationTrace[];
  summary: ExplorationSummary;
}

export interface TaskRunResult {
  taskId: string;
  trial: number;
  modelId: string;
  success: boolean;
  message: string;
  latencyMs: number;
  costUsd: number;
  urlAfter?: string;
  screenshotBase64?: string;
  domSnapshot?: string;
  trace: OperationTrace[];
  historyEntries?: StagehandHistoryEntry[];
  cacheHints?: ActionCacheEntry[];
  error?: string;
}

export interface CoverageGraphNode {
  id: string;
  url: string;
  domHash: string;
  visualHash: string;
  visits: number;
}

export interface CoverageGraphEdge {
  from: string;
  to: string;
  action: string;
  count: number;
}

export interface CoverageGraphSnapshot {
  nodes: CoverageGraphNode[];
  edges: CoverageGraphEdge[];
}

export interface StagehandRunConfig {
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  viewport: {
    width: number;
    height: number;
  };
}

export interface RunTaskInput {
  model: ModelAvailability;
  task: BenchmarkTask;
  trial: number;
  aut: AutConfig;
  runConfig: StagehandRunConfig;
  systemPrompt?: string;
  cacheHints?: ActionCacheEntry[];
}

export interface AutomationRunner {
  runTask(input: RunTaskInput): Promise<TaskRunResult>;
  exploreTarget?(input: {
    model: ModelAvailability;
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: AutConfig;
    runConfig: StagehandRunConfig;
    workspacePath: string;
  }): Promise<ExplorationArtifact>;
}

export type ExperimentTask = BenchmarkTask;
