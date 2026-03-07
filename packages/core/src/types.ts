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

export type TaskExpectationType = "contains" | "url_contains" | "text_visible";

export interface TaskExpectation {
  type: TaskExpectationType;
  value: string;
}

export interface ExperimentTask {
  id: string;
  instruction: string;
  expected: TaskExpectation;
  source: "synthetic" | "generated";
}

export interface AutConfig {
  url: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExperimentSpec {
  experimentId: string;
  aut: AutConfig;
  tasks: ExperimentTask[];
  corpusPaths: string[];
  models?: string[];
  trials: number;
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  viewport: {
    width: number;
    height: number;
  };
  seed: number;
  outputDir: string;
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
  createdAt: string;
}

export interface OperationTrace {
  timestamp: string;
  action: string;
  details?: Record<string, unknown>;
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
  error?: string;
}

export interface ModelRunMetrics {
  modelId: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  score: number;
  confidence95: {
    low: number;
    high: number;
  };
}

export interface ModelRunSummary {
  model: ModelAvailability;
  metrics: ModelRunMetrics;
  taskRuns: TaskRunResult[];
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

export interface RunArtifact {
  runId: string;
  experimentId: string;
  startedAt: string;
  finishedAt: string;
  spec: ExperimentSpec;
  modelSummaries: ModelRunSummary[];
  findings: Finding[];
  coverageGraph: CoverageGraphSnapshot;
}

export interface LeaderboardEntry {
  rank: number;
  modelId: string;
  provider: string;
  score: number;
  passRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}

export interface ExperimentReport {
  runId: string;
  experimentId: string;
  generatedAt: string;
  leaderboard: LeaderboardEntry[];
  confidence: Record<string, { low: number; high: number }>;
  failureClusters: Record<FailureCategory, number>;
  repairOutcomes: {
    fixed: number;
    not_fixed: number;
    regression: number;
    skipped: number;
  };
}

export interface RepairAttempt {
  attemptId: string;
  runId: string;
  findingId: string;
  outcome: "fixed" | "not_fixed" | "regression" | "skipped";
  note: string;
  patchPath?: string;
  validationExitCode?: number;
  createdAt: string;
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
  task: ExperimentTask;
  trial: number;
  aut: AutConfig;
  runConfig: StagehandRunConfig;
}

export interface AutomationRunner {
  runTask(input: RunTaskInput): Promise<TaskRunResult>;
}

export interface RunExperimentInput {
  specPath?: string;
  spec?: Partial<ExperimentSpec>;
  modelsPath?: string;
  reportsDir?: string;
  runner?: AutomationRunner;
}

export interface RunExperimentResult {
  artifact: RunArtifact;
  report: ExperimentReport;
  artifactPath: string;
  reportPath: string;
}
