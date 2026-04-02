import type {
  AiCostSource,
  AiUsageRecord,
  AiUsageSummary,
  BenchmarkTask,
  CacheUsageSummary,
  Finding,
  ModelAvailability,
  OperationTrace,
  ResolvedBenchmarkTarget,
  TaskRunResult,
  UsageCostSummary
} from "../types.js";

export type ExperimentKind = "qa" | "explore" | "heal";
export type ExperimentLogFn = (message: string) => void;
export type QaExecutionProfile = "fast" | "full";

export interface CapabilityDefinition {
  capabilityId: string;
  title: string;
  taskIds: string[];
}

export interface ExploreHeuristicTargets {
  minStates: number;
  minTransitions: number;
  actionKinds: string[];
}

export interface HealCaseDefinition {
  caseId: string;
  title: string;
  bugId: string;
  reproductionTaskIds: string[];
  regressionTaskIds: string[];
  goldTouchedFiles: string[];
  validationCommand?: string;
}

export interface AppBenchmarkManifest {
  appId: string;
  displayName: string;
  prompts: {
    qa: string;
    explore: string;
    heal: string;
  };
  runtime: {
    timeoutMs: number;
    retryCount: number;
    maxSteps: number;
    viewport: {
      width: number;
      height: number;
    };
    qaTrials: number;
    exploreTrials: number;
    healTrials: number;
  };
  capabilities: CapabilityDefinition[];
  qa: {
    capabilityIds: string[];
  };
  explore: {
    capabilityIds: string[];
    probeTaskIds: string[];
    heuristicTargets: ExploreHeuristicTargets;
  };
  heal: {
    caseIds: string[];
    cases: HealCaseDefinition[];
  };
}

export interface ResolvedAppBenchmark {
  manifestPath: string;
  benchmark: AppBenchmarkManifest;
  target: ResolvedBenchmarkTarget;
  tasks: Map<string, BenchmarkTask>;
  capabilityMap: Map<string, CapabilityDefinition>;
  healCaseMap: Map<string, HealCaseDefinition>;
}

export interface ExperimentRuntime {
  profile?: QaExecutionProfile;
  timeoutMs: number;
  retryCount: number;
  maxSteps: number;
  maxOutputTokens?: number;
  viewport: {
    width: number;
    height: number;
  };
}

export interface QaExperimentSpec {
  appId: string;
  capabilityIds: string[];
  taskIds: string[];
  models: string[];
  promptId: string;
  profile: QaExecutionProfile;
  trials: number;
  runtime: ExperimentRuntime;
  resultsDir: string;
}

export interface ExploreExperimentSpec {
  appId: string;
  capabilityIds: string[];
  probeTaskIds: string[];
  models?: string[];
  promptId: string;
  trials: number;
  runtime: ExperimentRuntime;
  resultsDir: string;
  heuristicTargets: ExploreHeuristicTargets;
}

export interface HealExperimentSpec {
  appId: string;
  caseIds: string[];
  models?: string[];
  promptId: string;
  trials: number;
  runtime: ExperimentRuntime;
  resultsDir: string;
}

export type RepairUsage = AiUsageSummary;

export interface CostGraphSeries {
  key: string;
  label: string;
  color: string;
}

export interface CostGraphDatum {
  modelId: string;
  provider: string;
  values: Record<string, number>;
  totalUsd?: number;
  costSource: AiCostSource;
  callCount?: number;
  note?: string;
}

export interface CostGraph {
  title: string;
  caption: string;
  stacked: boolean;
  series: CostGraphSeries[];
  data: CostGraphDatum[];
}

export interface RepairDiagnosis {
  summary: string;
  suspectedFiles: string[];
  notes?: string;
}

export interface RepairModelResult {
  diagnosis: RepairDiagnosis;
  patch?: string;
  usage: RepairUsage;
  rawResponse: string;
}

export interface QaCapabilityTrialResult {
  capabilityId: string;
  title: string;
  trial: number;
  success: boolean;
  taskIds: string[];
  failedTaskIds: string[];
}

export interface QaModelMetrics {
  modelId: string;
  capabilityPassRate: number;
  fullScenarioCompletionRate: number;
  stability: number;
  taskPassRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  score: number;
  executedTasks: number;
  skippedTasks: number;
}

export interface QaModelSummary {
  model: ModelAvailability;
  metrics: QaModelMetrics;
  cacheSummary?: CacheUsageSummary;
  taskRuns: TaskRunResult[];
  capabilityRuns: QaCapabilityTrialResult[];
}

export interface QaRunArtifact {
  kind: "qa";
  runId: string;
  appId: string;
  startedAt: string;
  finishedAt: string;
  spec: QaExperimentSpec;
  modelSummaries: QaModelSummary[];
}

export interface QaLeaderboardEntry {
  rank: number;
  modelId: string;
  provider: string;
  score: number;
  taskPassRate: number;
  capabilityPassRate: number;
  fullScenarioCompletionRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  costSummary: UsageCostSummary;
}

export interface QaReport {
  kind: "qa";
  runId: string;
  appId: string;
  generatedAt: string;
  spec: QaExperimentSpec;
  leaderboard: QaLeaderboardEntry[];
  modelSummaries: QaModelSummary[];
  costGraph: CostGraph;
  section: BenchmarkComparisonSection;
}

export interface ExploreCapabilityDiscovery {
  capabilityId: string;
  title: string;
  trial: number;
  discovered: boolean;
  matchedActionIds: string[];
}

export interface ExploreProbeRun {
  trial: number;
  taskId: string;
  success: boolean;
  matchedActionIds: string[];
  taskRun: TaskRunResult;
}

export interface ExploreTrialArtifact {
  trial: number;
  explorationRunId: string;
  statesDiscovered: number;
  transitionsDiscovered: number;
  actionsCached: number;
  actionKinds: string[];
  cacheSummary?: CacheUsageSummary;
  explorationUsage?: AiUsageSummary;
  probeUsage?: AiUsageSummary;
  totalUsage?: AiUsageSummary;
  capabilityDiscovery: ExploreCapabilityDiscovery[];
  probeRuns: ExploreProbeRun[];
}

export interface ExploreModelMetrics {
  modelId: string;
  capabilityDiscoveryRate: number;
  probeReplayPassRate: number;
  stateCoverage: number;
  transitionCoverage: number;
  actionDiversity: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  score: number;
}

export interface ExploreModelSummary {
  model: ModelAvailability;
  metrics: ExploreModelMetrics;
  probeCacheSummary?: CacheUsageSummary;
  trials: ExploreTrialArtifact[];
}

export interface ExploreRunArtifact {
  kind: "explore";
  runId: string;
  appId: string;
  startedAt: string;
  finishedAt: string;
  spec: ExploreExperimentSpec;
  modelSummaries: ExploreModelSummary[];
}

export interface ExploreLeaderboardEntry {
  rank: number;
  modelId: string;
  provider: string;
  score: number;
  capabilityDiscoveryRate: number;
  probeReplayPassRate: number;
  stateCoverage: number;
  transitionCoverage: number;
  actionDiversity: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  costSummary: UsageCostSummary;
}

export interface ExploreReport {
  kind: "explore";
  runId: string;
  appId: string;
  generatedAt: string;
  spec: ExploreExperimentSpec;
  leaderboard: ExploreLeaderboardEntry[];
  modelSummaries: ExploreModelSummary[];
  costGraph: CostGraph;
  section: BenchmarkComparisonSection;
}

export interface HealCaseTrialResult {
  caseId: string;
  title: string;
  trial: number;
  reproductionRuns: TaskRunResult[];
  findings: Finding[];
  diagnosis?: RepairDiagnosis;
  suspectedFiles: string[];
  goldTouchedFiles: string[];
  patchGenerated: boolean;
  patchApplied: boolean;
  validationPassed: boolean;
  validationExitCode?: number;
  failingTaskFixRate: number;
  regressionFreeRate: number;
  localizationScore: number;
  fixed: boolean;
  repairUsage: RepairUsage;
  reproductionUsage?: AiUsageSummary;
  postPatchUsage?: AiUsageSummary;
  totalUsage?: AiUsageSummary;
  patchPath?: string;
  note: string;
  postPatchReproductionRuns: TaskRunResult[];
  postPatchRegressionRuns: TaskRunResult[];
}

export interface HealModelMetrics {
  modelId: string;
  localizationAccuracy: number;
  patchApplyRate: number;
  validationPassRate: number;
  failingTaskFixRate: number;
  regressionFreeRate: number;
  fixRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  score: number;
}

export interface HealModelSummary {
  model: ModelAvailability;
  metrics: HealModelMetrics;
  cacheSummary?: CacheUsageSummary;
  caseResults: HealCaseTrialResult[];
}

export interface HealRunArtifact {
  kind: "heal";
  runId: string;
  appId: string;
  startedAt: string;
  finishedAt: string;
  spec: HealExperimentSpec;
  modelSummaries: HealModelSummary[];
}

export interface HealLeaderboardEntry {
  rank: number;
  modelId: string;
  provider: string;
  score: number;
  localizationAccuracy: number;
  patchApplyRate: number;
  validationPassRate: number;
  failingTaskFixRate: number;
  regressionFreeRate: number;
  fixRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  costSummary: UsageCostSummary;
}

export interface HealReport {
  kind: "heal";
  runId: string;
  appId: string;
  generatedAt: string;
  spec: HealExperimentSpec;
  leaderboard: HealLeaderboardEntry[];
  modelSummaries: HealModelSummary[];
  costGraph: CostGraph;
  section: BenchmarkComparisonSection;
}

export interface ExperimentRunPaths {
  artifactPath: string;
  reportPath: string;
  htmlPath: string;
}

export interface QaRunResult extends ExperimentRunPaths {
  artifact: QaRunArtifact;
  report: QaReport;
}

export interface ExploreRunResult extends ExperimentRunPaths {
  artifact: ExploreRunArtifact;
  report: ExploreReport;
}

export interface HealRunResult extends ExperimentRunPaths {
  artifact: HealRunArtifact;
  report: HealReport;
}

export interface CompareLeaderboardEntry {
  modelId: string;
  avgScore: number;
  runs: number;
}

export interface ModeComparisonBuildResult {
  aggregateLeaderboard: CompareLeaderboardEntry[];
  modeSection: BenchmarkComparisonSection;
}

export interface BenchmarkMetricColumn {
  key: string;
  label: string;
  kind: "score" | "percent" | "ms" | "usd" | "integer" | "text";
  aggregate: "mean" | "sum" | "first";
}

export interface BenchmarkComparisonCell {
  appId: string;
  runIds: string[];
  metrics: Record<string, number | string | null>;
  costSummary: UsageCostSummary;
}

export interface BenchmarkComparisonRow {
  modelId: string;
  provider: string;
  avgScore: number;
  cells: BenchmarkComparisonCell[];
}

export interface BenchmarkAuditTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface BenchmarkComparisonSection {
  kind: ExperimentKind;
  title: string;
  summary: string;
  appIds: string[];
  metricColumns: BenchmarkMetricColumn[];
  rows: BenchmarkComparisonRow[];
  notes: string[];
  audit: BenchmarkAuditTable;
}

export interface BenchmarkSummaryFigures {
  rankMatrix: BenchmarkRankMatrixFigure;
  efficiencyFrontier: BenchmarkEfficiencyFrontierFigure;
}

export interface BenchmarkRankMatrixFigure {
  title: string;
  caption: string;
  modeOrder: ExperimentKind[];
  columns: BenchmarkRankMatrixColumn[];
  rows: BenchmarkRankMatrixRow[];
}

export interface BenchmarkRankMatrixColumn {
  key: string;
  kind: ExperimentKind;
  modeTitle: string;
  appId: string;
  label: string;
}

export interface BenchmarkRankMatrixRow {
  modelId: string;
  provider: string;
  meanRank: number | null;
  meanScore: number | null;
  meanTotalCost: number | null;
  meanAvgCost: number | null;
  meanAvgLatency: number | null;
  cells: BenchmarkRankMatrixCell[];
}

export interface BenchmarkRankMatrixCell {
  columnKey: string;
  kind: ExperimentKind;
  appId: string;
  runIds: string[];
  missing: boolean;
  rank: number | null;
  rankPercentile: number | null;
  score: number | null;
  avgLatency: number | null;
  avgCost: number | null;
  totalCost: number | null;
}

export interface BenchmarkEfficiencyFrontierFigure {
  title: string;
  caption: string;
  modeOrder: ExperimentKind[];
  xDomain: {
    min: number;
    max: number;
  };
  yDomain: {
    min: number;
    max: number;
  };
  legend: BenchmarkEfficiencyFrontierLegendEntry[];
  panels: BenchmarkEfficiencyFrontierPanel[];
}

export interface BenchmarkEfficiencyFrontierLegendEntry {
  modelId: string;
  provider: string;
  color: string;
}

export interface BenchmarkEfficiencyFrontierPanel {
  kind: ExperimentKind;
  title: string;
  points: BenchmarkEfficiencyFrontierPoint[];
}

export interface BenchmarkEfficiencyFrontierPoint {
  modelId: string;
  provider: string;
  color: string;
  avgLatency: number;
  avgCost: number;
  avgScore: number;
  paretoOptimal: boolean;
}

export interface CompareResult<TReport> {
  kind: ExperimentKind;
  reports: TReport[];
  aggregateLeaderboard: CompareLeaderboardEntry[];
  modeSection: BenchmarkComparisonSection;
  finalReportPath: string;
  finalJsonPath: string;
}

export interface BenchmarkComparisonReport {
  title: string;
  subtitle: string;
  generatedAt: string;
  runIds: string[];
  appIds: string[];
  modeSections: BenchmarkComparisonSection[];
  summaryFigures?: BenchmarkSummaryFigures;
  finalReportPath: string;
  finalJsonPath: string;
  provenance?: BenchmarkComparisonProvenance;
}

export interface BenchmarkComparisonProvenanceEntry {
  kind: ExperimentKind;
  appId: string;
  runId: string;
  generatedAt: string;
  reportPath: string;
}

export interface BenchmarkComparisonProvenance {
  selectionPolicy: "latest-per-app-mode";
  note: string;
  selectedReports: BenchmarkComparisonProvenanceEntry[];
}

export interface RepairPromptContext {
  appId: string;
  findings: Finding[];
  candidateFiles: Array<{
    path: string;
    reasons: string[];
    content: string;
  }>;
  validationCommand: string;
  traces: OperationTrace[];
}
