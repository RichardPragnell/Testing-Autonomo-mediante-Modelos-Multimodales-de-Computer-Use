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
  enabled: boolean;
}

export interface ModelAvailability extends ModelConfig {
  available: boolean;
  reason?: string;
}

export interface ModelRegistry {
  models: ModelConfig[];
}

export type AiCostSource = "exact" | "estimated" | "unavailable";

export type AiUsagePhase =
  | "guided_scenario"
  | "guided_step"
  | "exploration"
  | "probe_replay"
  | "reproduction"
  | "repair"
  | "post_patch_replay";

export type AiOperation =
  | "act"
  | "observe"
  | "extract"
  | "metadata"
  | "agent"
  | "unknown";

export interface AiUsageRecord {
  phase: AiUsagePhase;
  operation: AiOperation;
  requestedModelId: string;
  requestedProvider: string;
  servedModelId?: string;
  servedProvider?: string;
  generationId?: string;
  costSource: AiCostSource;
  costUsd?: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  timestamp: string;
  error?: string;
}

export interface AiUsageSummary {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  costUsd?: number;
  resolvedCostUsd?: number;
  costSource: AiCostSource;
  callCount?: number;
  unavailableCalls?: number;
}

export interface UsageCostSummary {
  avgResolvedUsd: number;
  totalResolvedUsd: number;
  costSource: AiCostSource;
  callCount: number;
  unavailableCalls: number;
}

export type BenchmarkScenarioSource = "synthetic" | "generated";

export interface ObserveScenarioAssertion {
  assertionId: string;
  type: "observe";
  instruction: string;
  exists: boolean;
  method?: string;
  descriptionContains?: string;
}

export type ExtractAssertionResultType = "string" | "number" | "boolean" | "string_array";

export type ExtractScenarioAssertionMatch =
  | { equals: string | number | boolean }
  | { contains: string }
  | { not_contains: string }
  | { includes: string }
  | { excludes: string };

export interface ExtractScenarioAssertion {
  assertionId: string;
  type: "extract";
  instruction: string;
  selector?: string;
  resultType: ExtractAssertionResultType;
  match: ExtractScenarioAssertionMatch;
}

export type BenchmarkScenarioAssertion = ObserveScenarioAssertion | ExtractScenarioAssertion;

export interface BenchmarkScenarioStep {
  stepId: string;
  title: string;
  actionInstruction?: string;
  assertions: BenchmarkScenarioAssertion[];
  scenarioId?: string;
}

export interface BenchmarkScenario {
  scenarioId: string;
  title: string;
  source: BenchmarkScenarioSource;
  steps: BenchmarkScenarioStep[];
}

export interface BugPackDefinition {
  bugId: string;
  title: string;
  description: string;
  category: FailureCategory;
  severity: "low" | "medium" | "high";
  patchPath: string;
  expectedFailureScenarioIds: string[];
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
  profile?: "fast" | "full";
  trials: number;
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  maxOutputTokens?: number;
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
  releasePort?: () => void;
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
  scenarioId: string;
  stepId: string;
  assertionId?: string;
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

export type CacheMode = "scenario_native" | "observe_manual";

export type CacheStatus = "hit" | "miss" | "refreshed_after_failure";

export interface ExecutionCacheConfig {
  rootDir: string;
  namespace: string;
  cacheDir: string;
  configSignature: string;
}

export interface CacheTelemetry {
  rootDir: string;
  namespace: string;
  configSignature: string;
  mode: CacheMode;
  status: CacheStatus;
  aiInvoked: boolean;
  warnings: string[];
}

export interface CacheUsageSummary {
  rootDir: string;
  namespace: string;
  configSignature: string;
  total: number;
  hits: number;
  misses: number;
  refreshedAfterFailure: number;
  aiInvocations: number;
  warnings: string[];
  modes: CacheMode[];
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

export interface ObserveCacheEntry {
  entryId: string;
  key: string;
  instruction: string;
  stateId: string;
  url: string;
  domHash: string;
  visualHash: string;
  actions: ObservedAction[];
  hitCount: number;
  createdAt: string;
  updatedAt: string;
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
  observeCacheEntries: number;
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
  observeCache: ObserveCacheEntry[];
  actionCache: ActionCacheEntry[];
  cacheSummary?: CacheUsageSummary;
  usageSummary?: AiUsageSummary;
  aiCalls?: AiUsageRecord[];
  trace: OperationTrace[];
  summary: ExplorationSummary;
}

export interface ScenarioAssertionRun {
  assertionId: string;
  type: BenchmarkScenarioAssertion["type"];
  success: boolean;
  message: string;
  observedActions?: ObservedAction[];
  extractedValue?: string | number | boolean | string[];
  error?: string;
}

export interface ScenarioStepRun {
  stepId: string;
  title: string;
  success: boolean;
  message: string;
  actionInstruction?: string;
  observedActions?: ObservedAction[];
  executedAction?: ObservedAction;
  assertionRuns: ScenarioAssertionRun[];
  urlAfter?: string;
}

export interface ScenarioRunResult {
  scenarioId: string;
  scenarioTitle: string;
  trial: number;
  modelId: string;
  success: boolean;
  message: string;
  latencyMs: number;
  costUsd?: number;
  usageSummary?: AiUsageSummary;
  aiCalls?: AiUsageRecord[];
  urlAfter?: string;
  screenshotBase64?: string;
  domSnapshot?: string;
  trace: OperationTrace[];
  historyEntries?: StagehandHistoryEntry[];
  cache?: CacheTelemetry;
  error?: string;
  stepRuns: ScenarioStepRun[];
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
  profile?: "fast" | "full";
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  maxOutputTokens?: number;
  viewport: {
    width: number;
    height: number;
  };
}

export interface RunScenarioInput {
  model: ModelAvailability;
  scenario: BenchmarkScenario;
  trial: number;
  aut: AutConfig;
  runConfig: StagehandRunConfig;
  cacheConfig: ExecutionCacheConfig;
  usagePhase?: AiUsagePhase;
  systemPrompt?: string;
}

export interface AutomationRunner {
  runScenario(input: RunScenarioInput): Promise<ScenarioRunResult>;
  exploreTarget?(input: {
    model: ModelAvailability;
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: AutConfig;
    runConfig: StagehandRunConfig;
    cacheConfig: ExecutionCacheConfig;
    workspacePath: string;
  }): Promise<ExplorationArtifact>;
}
