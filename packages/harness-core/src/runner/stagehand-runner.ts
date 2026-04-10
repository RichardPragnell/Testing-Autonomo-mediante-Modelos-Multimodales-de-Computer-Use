import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  applyOpenRouterModelCooldown,
  computeOpenRouterRetryDelayMs,
  getOpenRouterModelCooldownDelay
} from "../ai/openrouter-limiter.js";
import { summarizeCacheTelemetry } from "../cache/summary.js";
import { isOpenRouterCostTrackingEnabled } from "../ai/openrouter.js";
import { emptyAiUsageSummary, summarizeAiUsage, sumAiUsageSummaries } from "../ai/usage.js";
import { buildActionCacheEntries, markExecutedActions } from "../exploration/action-cache.js";
import {
  findObserveCacheEntry,
  loadObserveCache,
  markObserveCacheHit,
  saveObserveCache,
  upsertObserveCacheEntry
} from "../exploration/observe-cache.js";
import { CoverageGraph, fingerprintState } from "../graph/state-graph.js";
import type {
  ActionCacheEntry,
  AiUsagePhase,
  AiUsageRecord,
  AiUsageSummary,
  AutomationRunner,
  BenchmarkScenarioAssertion,
  BenchmarkScenarioStep,
  CacheStatus,
  CacheTelemetry,
  ExplorationArtifact,
  ExtractScenarioAssertion,
  ObserveScenarioAssertion,
  ObserveCacheEntry,
  ObservedAction,
  OperationTrace,
  RunScenarioInput,
  ScenarioAssertionRun,
  ScenarioRunResult,
  ScenarioStepRun,
  StagehandHistoryEntry,
} from "../types.js";
import { nowIso } from "../utils/time.js";
import { StagehandOpenRouterTrackingClient } from "./stagehand-openrouter-client.js";

type StagehandLogLine = {
  category?: string;
  message: string;
  level?: number;
  timestamp?: string;
};

const GENERIC_PROVIDER_ERROR_PATTERNS = [
  /^provider returned error$/i,
  /^failed after \d+ attempts(?: with non-retryable error)?: ['"]?provider returned error['"]?$/i,
  /^failed after \d+ attempts\. last error: provider returned error$/i
];

function isGenericProviderError(message: string): boolean {
  return GENERIC_PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function collectErrorMessages(
  value: unknown,
  messages: string[],
  seen: Set<unknown>,
  depth = 0
): void {
  if (value === undefined || value === null || depth > 4) {
    return;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    messages.push(normalized);
    const parsed = normalized.startsWith("{") || normalized.startsWith("[") ? tryParseJson(normalized) : undefined;
    if (parsed && !seen.has(parsed)) {
      collectErrorMessages(parsed, messages, seen, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (value instanceof Error) {
    collectErrorMessages(value.message, messages, seen, depth + 1);
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "message",
    "error",
    "cause",
    "description",
    "details",
    "responseBody",
    "body",
    "data",
    "value"
  ]) {
    if (key in record) {
      collectErrorMessages(record[key], messages, seen, depth + 1);
    }
  }

  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      collectErrorMessages(item, messages, seen, depth + 1);
    }
  }
}

function scoreErrorMessage(message: string): number {
  let score = Math.min(message.length, 240);
  if (isGenericProviderError(message)) {
    score -= 10_000;
  }
  if (/rate limit|too many requests|free-models-per-min|429/i.test(message)) {
    score += 1_000;
  }
  if (/no endpoints available|guardrail restrictions|data policy/i.test(message)) {
    score += 900;
  }
  if (/provider returned error/i.test(message)) {
    score -= 200;
  }
  return score;
}

export function normalizeExecutionError(error: unknown): string {
  const messages: string[] = [];
  collectErrorMessages(error, messages, new Set());
  const uniqueMessages = [...new Set(messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (!uniqueMessages.length) {
    return String(error);
  }

  return uniqueMessages.sort((left, right) => scoreErrorMessage(right) - scoreErrorMessage(left))[0]!;
}

export function computeRetryDelayMs(input: {
  attempt: number;
  modelId: string;
  errorMessage: string;
  env?: NodeJS.ProcessEnv;
}): number {
  return computeOpenRouterRetryDelayMs(input);
}

function estimateAiInvocation(metrics: any): boolean {
  if (!metrics) {
    return false;
  }

  return (
    Number(metrics.totalPromptTokens ?? 0) +
      Number(metrics.totalCompletionTokens ?? 0) +
      Number(metrics.totalReasoningTokens ?? 0) >
    0
  );
}

function normalizeHistoryEntry(entry: any): StagehandHistoryEntry {
  return {
    method: String(entry?.method ?? "unknown"),
    parameters:
      entry?.parameters && typeof entry.parameters === "object"
        ? (entry.parameters as Record<string, unknown>)
        : undefined,
    result: entry?.result,
    timestamp: String(entry?.timestamp ?? nowIso())
  };
}

async function readStagehandMetrics(stagehand: any): Promise<any> {
  try {
    const metrics = stagehand?.metrics;
    return metrics && typeof metrics.then === "function" ? await metrics : metrics;
  } catch {
    return undefined;
  }
}

async function readStagehandHistory(stagehand: any): Promise<StagehandHistoryEntry[]> {
  try {
    const history = stagehand?.history;
    const resolved = history && typeof history.then === "function" ? await history : history;
    return Array.isArray(resolved) ? resolved.map(normalizeHistoryEntry) : [];
  } catch {
    return [];
  }
}

function readBooleanEnv(name: string): boolean | undefined {
  const rawValue = process.env[name];
  if (!rawValue) {
    return undefined;
  }
  return !["0", "false", "no", "off"].includes(rawValue.toLowerCase());
}

function buildLocalBrowserLaunchOptions(input: {
  viewport: RunScenarioInput["runConfig"]["viewport"];
}): Record<string, unknown> {
  const options: Record<string, unknown> = {
    viewport: input.viewport
  };
  const executablePath = process.env.STAGEHAND_LOCAL_BROWSER_PATH?.trim();
  if (executablePath) {
    options.executablePath = executablePath;
  }

  const headless = readBooleanEnv("STAGEHAND_LOCAL_HEADLESS");
  if (typeof headless === "boolean") {
    options.headless = headless;
  }

  const devtools = readBooleanEnv("STAGEHAND_LOCAL_DEVTOOLS");
  if (typeof devtools === "boolean") {
    options.devtools = devtools;
  }

  const extraArgs = process.env.STAGEHAND_LOCAL_BROWSER_ARGS?.trim();
  if (extraArgs) {
    options.args = extraArgs.split(/\s+/);
  }

  return options;
}

function normalizeStagehandLog(line: any): StagehandLogLine | undefined {
  if (!line || typeof line !== "object" || typeof line.message !== "string") {
    return undefined;
  }

  return {
    category: typeof line.category === "string" ? line.category : undefined,
    message: line.message,
    level: typeof line.level === "number" ? line.level : undefined,
    timestamp: typeof line.timestamp === "string" ? line.timestamp : nowIso()
  };
}

function createStagehandLogCollector(target: StagehandLogLine[]) {
  return (line: any) => {
    const normalized = normalizeStagehandLog(line);
    if (!normalized || normalized.category !== "cache") {
      return;
    }
    target.push(normalized);
  };
}

function buildUsageSummaryFromMetrics(input: {
  metrics: any;
}): AiUsageSummary {
  const promptTokens = Number(input.metrics?.totalPromptTokens ?? 0);
  const completionTokens = Number(input.metrics?.totalCompletionTokens ?? 0);
  const reasoningTokens = Number(input.metrics?.totalReasoningTokens ?? 0);
  const cachedInputTokens = Number(input.metrics?.totalCachedInputTokens ?? 0);
  const totalTokens = promptTokens + completionTokens + reasoningTokens;

  if (totalTokens === 0) {
    return emptyAiUsageSummary("exact");
  }

  return {
    latencyMs: Number(input.metrics?.totalInferenceTimeMs ?? 0),
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens,
    costUsd: undefined,
    resolvedCostUsd: 0,
    costSource: "unavailable",
    callCount: totalTokens > 0 ? 1 : 0,
    unavailableCalls: totalTokens > 0 ? 1 : 0
  };
}

function buildAttemptUsageSummary(input: {
  aiCalls: AiUsageRecord[];
  metrics: any;
}): AiUsageSummary {
  if (input.aiCalls.length > 0) {
    return summarizeAiUsage(input.aiCalls);
  }

  if (!input.metrics) {
    return emptyAiUsageSummary("exact");
  }

  return buildUsageSummaryFromMetrics({
    metrics: input.metrics
  });
}

function buildStagehandConfig(
  stagehandEnv: string,
  input: {
    model: RunScenarioInput["model"];
    runConfig: RunScenarioInput["runConfig"];
    cacheConfig: RunScenarioInput["cacheConfig"];
    usagePhase: AiUsagePhase;
    usageSink: AiUsageRecord[];
    logger?: (line: any) => void;
  }
): any {
  if (!isOpenRouterCostTrackingEnabled()) {
    throw new Error("OPENROUTER_API_KEY is required for benchmark execution");
  }

  const config: any = {
    env: stagehandEnv as any,
    model: input.model.id,
    cacheDir: input.cacheConfig.cacheDir,
    selfHeal: true,
    llmClient: new StagehandOpenRouterTrackingClient({
      modelId: input.model.id,
      provider: input.model.provider,
      phase: input.usagePhase,
      usageSink: input.usageSink,
      defaultMaxOutputTokens: input.runConfig.maxOutputTokens
    })
  };

  if (input.logger) {
    config.logger = input.logger;
  }

  if (stagehandEnv === "LOCAL") {
    config.localBrowserLaunchOptions = {
      ...buildLocalBrowserLaunchOptions({
        viewport: input.runConfig.viewport
      })
    };
  }

  return config;
}

function appendHistoryTrace(trace: OperationTrace[], history: StagehandHistoryEntry[]): void {
  for (const item of history) {
    trace.push({
      timestamp: item.timestamp,
      action: item.method,
      details: item.parameters
    });
  }
}

function appendCacheTrace(trace: OperationTrace[], cache: CacheTelemetry | undefined): void {
  if (!cache) {
    return;
  }

  trace.push({
    timestamp: nowIso(),
    action: `cache.${cache.mode}`,
    details: {
      namespace: cache.namespace,
      rootDir: cache.rootDir,
      configSignature: cache.configSignature,
      status: cache.status,
      aiInvoked: cache.aiInvoked,
      warnings: cache.warnings
    }
  });
}

async function readPageSummary(page: any): Promise<string> {
  try {
    const summary = await page?.evaluate?.(() => {
      const title = document.title?.trim() ?? "";
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((item) => item.textContent?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");
      const body = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
      return [title, headings, body].filter(Boolean).join(" - ");
    });
    return typeof summary === "string" && summary.trim() ? summary.trim() : "Page summary unavailable";
  } catch {
    return "Page summary unavailable";
  }
}

async function snapshotPage(page: any): Promise<{
  url: string;
  domSnapshot?: string;
  screenshotBase64?: string;
  summary: string;
}> {
  const domSnapshot = await page.content?.();
  const screenshot = await page.screenshot?.({ type: "png" });
  const url = typeof page?.url === "function" ? String(page.url()) : "";
  return {
    url,
    domSnapshot,
    screenshotBase64: screenshot ? Buffer.from(screenshot).toString("base64") : undefined,
    summary: await readPageSummary(page)
  };
}

function normalizeObservedActions(actions: any[]): ObservedAction[] {
  return actions
    .filter((item) => item && typeof item === "object" && item.selector && item.description)
    .map((item) => ({
      selector: String(item.selector),
      description: String(item.description),
      method: item.method ? String(item.method) : undefined,
      arguments: Array.isArray(item.arguments) ? item.arguments.map((value: unknown) => String(value)) : []
    }));
}

function updateStateActionCache(
  cache: ActionCacheEntry[],
  stateId: string,
  incoming: ActionCacheEntry[]
): ActionCacheEntry[] {
  const previousById = new Map(
    cache.filter((entry) => entry.stateId === stateId).map((entry) => [entry.actionId, entry])
  );
  const preserved = cache.filter((entry) => entry.stateId !== stateId);

  return [
    ...preserved,
    ...incoming.map((entry) => {
      const previous = previousById.get(entry.actionId);
      if (!previous) {
        return entry;
      }

      return {
        ...entry,
        instructionHints: [...new Set([...previous.instructionHints, ...entry.instructionHints])],
        observationCount: previous.observationCount + entry.observationCount,
        executionCount: previous.executionCount
      };
    })
  ];
}

function chooseExplorationAction(
  actionCache: ActionCacheEntry[],
  executedActionIds: Set<string>,
  stateId: string
): ActionCacheEntry | undefined {
  return actionCache
    .filter((entry) => entry.stateId === stateId && !executedActionIds.has(entry.actionId))
    .sort((left, right) => left.executionCount - right.executionCount || left.description.localeCompare(right.description))
    .at(0);
}

function buildExecutableAction(entry: ActionCacheEntry, step: number): ObservedAction {
  const defaultArguments =
    entry.method === "fill" && entry.arguments.length === 0 ? [`Explore step ${step + 1}`] : entry.arguments;

  return {
    selector: entry.selector,
    description: entry.description,
    method: entry.method,
    arguments: defaultArguments
  };
}

function buildScenarioCacheTelemetry(input: {
  cacheConfig: RunScenarioInput["cacheConfig"];
  metrics: any;
  logs: StagehandLogLine[];
}): CacheTelemetry {
  const messages = input.logs.map((item) => item.message.toLowerCase());
  const hasHit = messages.some((message) => message.includes("cache hit"));
  const replayFailed = messages.some((message) => message.includes("cache replay failed"));
  const selfHealed = messages.some((message) => message.includes("cache entry updated after self-heal"));
  const warnings: string[] = [];

  if (replayFailed) {
    warnings.push("Stagehand cache replay failed and AI fallback refreshed the cache.");
  }
  if (selfHealed) {
    warnings.push("Stagehand cache replay self-healed cached selectors or actions.");
  }

  const status: CacheStatus = replayFailed || selfHealed ? "refreshed_after_failure" : hasHit ? "hit" : "miss";

  return {
    rootDir: input.cacheConfig.rootDir,
    namespace: input.cacheConfig.namespace,
    configSignature: input.cacheConfig.configSignature,
    mode: "scenario_native",
    status,
    aiInvoked: estimateAiInvocation(input.metrics),
    warnings
  };
}

function buildObserveCacheTelemetry(input: {
  cacheConfig: RunScenarioInput["cacheConfig"];
  status: CacheStatus;
  warnings?: string[];
}): CacheTelemetry {
  return {
    rootDir: input.cacheConfig.rootDir,
    namespace: input.cacheConfig.namespace,
    configSignature: input.cacheConfig.configSignature,
    mode: "observe_manual",
    status: input.status,
    aiInvoked: input.status !== "hit",
    warnings: input.warnings ?? []
  };
}

function buildExplorationObserveInstruction(prompt: string): string {
  return `Exploration goal: ${prompt}\nFind the most useful clickable, toggle, navigation, save, cancel, edit, delete, or fill actions on this page for continuing exploration.`;
}

function currentPageUrl(page: any, fallback = ""): string {
  try {
    return typeof page?.url === "function" ? String(page.url()) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMethod(value: string | undefined): string {
  return (value ?? "click").trim().toLowerCase();
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function buildExtractSchema(assertion: ExtractScenarioAssertion) {
  switch (assertion.resultType) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string_array":
      return z.array(z.string());
  }
}

function normalizeExtractedValue(
  assertion: ExtractScenarioAssertion,
  rawValue: unknown
): ScenarioAssertionRun["extractedValue"] {
  const extracted =
    rawValue && typeof rawValue === "object" && "extraction" in rawValue
      ? (rawValue as { extraction: unknown }).extraction
      : rawValue;

  switch (assertion.resultType) {
    case "string":
      return String(extracted ?? "");
    case "number":
      return Number(extracted);
    case "boolean":
      return Boolean(extracted);
    case "string_array":
      return Array.isArray(extracted) ? extracted.map((item) => String(item)) : [];
  }
}

function filterObservedActions(
  observedActions: ObservedAction[],
  assertion: ObserveScenarioAssertion
): ObservedAction[] {
  return observedActions.filter((action) => {
    if (assertion.method && normalizeMethod(action.method) !== normalizeMethod(assertion.method)) {
      return false;
    }
    if (
      assertion.descriptionContains &&
      !action.description.toLowerCase().includes(assertion.descriptionContains.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

function evaluateExtractAssertion(
  assertion: ExtractScenarioAssertion,
  extractedValue: ScenarioAssertionRun["extractedValue"]
): Pick<ScenarioAssertionRun, "success" | "message"> {
  if ("equals" in assertion.match) {
    const success = extractedValue === assertion.match.equals;
    return {
      success,
      message: success
        ? `Extract matched ${formatValue(assertion.match.equals)}.`
        : `Expected ${formatValue(assertion.match.equals)} but got ${formatValue(extractedValue)}.`
    };
  }

  if ("contains" in assertion.match) {
    const actual = typeof extractedValue === "string" ? extractedValue : "";
    const success = actual.includes(assertion.match.contains);
    return {
      success,
      message: success
        ? `Extract contains ${formatValue(assertion.match.contains)}.`
        : `Expected extract to contain ${formatValue(assertion.match.contains)} but got ${formatValue(actual)}.`
    };
  }

  if ("not_contains" in assertion.match) {
    const actual = typeof extractedValue === "string" ? extractedValue : "";
    const success = !actual.includes(assertion.match.not_contains);
    return {
      success,
      message: success
        ? `Extract excludes ${formatValue(assertion.match.not_contains)}.`
        : `Expected extract to exclude ${formatValue(assertion.match.not_contains)} but got ${formatValue(actual)}.`
    };
  }

  if ("includes" in assertion.match) {
    const actual = Array.isArray(extractedValue) ? extractedValue : [];
    const success = actual.includes(assertion.match.includes);
    return {
      success,
      message: success
        ? `Extract includes ${formatValue(assertion.match.includes)}.`
        : `Expected extract to include ${formatValue(assertion.match.includes)} but got ${formatValue(actual)}.`
    };
  }

  const actual = Array.isArray(extractedValue) ? extractedValue : [];
  const success = !actual.includes(assertion.match.excludes);
  return {
    success,
    message: success
      ? `Extract excludes ${formatValue(assertion.match.excludes)}.`
      : `Expected extract to exclude ${formatValue(assertion.match.excludes)} but got ${formatValue(actual)}.`
  };
}

async function executeScenarioAssertion(input: {
  stagehand: any;
  assertion: BenchmarkScenarioAssertion;
  step: BenchmarkScenarioStep;
  trace: OperationTrace[];
}): Promise<ScenarioAssertionRun> {
  const traceBase = {
    stepId: input.step.stepId,
    assertionId: input.assertion.assertionId,
    instruction: "instruction" in input.assertion ? input.assertion.instruction : undefined
  };

  if (input.assertion.type === "observe") {
    try {
      if (typeof input.stagehand.observe !== "function") {
        throw new Error("stagehand observe not available");
      }

      const observedActions = normalizeObservedActions(await input.stagehand.observe(input.assertion.instruction));
      const matchingActions = filterObservedActions(observedActions, input.assertion);
      const success = input.assertion.exists ? matchingActions.length > 0 : matchingActions.length === 0;
      const requirementParts = [];
      if (input.assertion.method) {
        requirementParts.push(`method=${input.assertion.method}`);
      }
      if (input.assertion.descriptionContains) {
        requirementParts.push(`description includes ${formatValue(input.assertion.descriptionContains)}`);
      }
      const requirement = requirementParts.length ? ` with ${requirementParts.join(", ")}` : "";
      const message = success
        ? input.assertion.exists
          ? `Observed ${matchingActions.length} matching action(s)${requirement}.`
          : `No matching action observed${requirement}.`
        : input.assertion.exists
          ? `Expected an observable action${requirement}, but none matched.`
          : `Expected no observable action${requirement}, but found ${matchingActions.length}.`;

      input.trace.push({
        timestamp: nowIso(),
        action: "scenario.assert.observe",
        details: {
          ...traceBase,
          observedActions: observedActions.length,
          matchingActions: matchingActions.length,
          success
        }
      });

      return {
        assertionId: input.assertion.assertionId,
        type: input.assertion.type,
        success,
        message,
        observedActions
      };
    } catch (error) {
      const message = normalizeExecutionError(error);
      return {
        assertionId: input.assertion.assertionId,
        type: input.assertion.type,
        success: false,
        message: `Observe assertion failed: ${message}`,
        error: message
      };
    }
  }

  try {
    if (typeof input.stagehand.extract !== "function") {
      throw new Error("stagehand extract not available");
    }

    const schema = buildExtractSchema(input.assertion);
    const extracted = input.assertion.selector
      ? await input.stagehand.extract(input.assertion.instruction, schema, { selector: input.assertion.selector })
      : await input.stagehand.extract(input.assertion.instruction, schema);
    const extractedValue = normalizeExtractedValue(input.assertion, extracted);
    const evaluation = evaluateExtractAssertion(input.assertion, extractedValue);

    input.trace.push({
      timestamp: nowIso(),
      action: "scenario.assert.extract",
      details: {
        ...traceBase,
        selector: input.assertion.selector,
        resultType: input.assertion.resultType,
        success: evaluation.success
      }
    });

    return {
      assertionId: input.assertion.assertionId,
      type: input.assertion.type,
      success: evaluation.success,
      message: evaluation.message,
      extractedValue
    };
  } catch (error) {
    const message = normalizeExecutionError(error);
    return {
      assertionId: input.assertion.assertionId,
      type: input.assertion.type,
      success: false,
      message: `Extract assertion failed: ${message}`,
      error: message
    };
  }
}

async function executeScenarioStep(input: {
  stagehand: any;
  page: any;
  step: BenchmarkScenarioStep;
  trace: ScenarioRunResult["trace"];
}): Promise<ScenarioStepRun> {
  const stepRun: ScenarioStepRun = {
    stepId: input.step.stepId,
    title: input.step.title,
    success: false,
    message: "",
    actionInstruction: input.step.actionInstruction,
    assertionRuns: []
  };

  input.trace.push({
    timestamp: nowIso(),
    action: "scenario.step.start",
    details: {
      stepId: input.step.stepId,
      title: input.step.title
    }
  });

  if (input.step.actionInstruction) {
    try {
      if (typeof input.stagehand.observe !== "function") {
        throw new Error("stagehand observe not available");
      }

      const observedActions = normalizeObservedActions(await input.stagehand.observe(input.step.actionInstruction));
      stepRun.observedActions = observedActions;
      input.trace.push({
        timestamp: nowIso(),
        action: "scenario.step.observe",
        details: {
          stepId: input.step.stepId,
          instruction: input.step.actionInstruction,
          candidates: observedActions.length
        }
      });

      const action = observedActions[0];
      if (!action) {
        stepRun.message = `No candidate action observed for "${input.step.actionInstruction}".`;
        stepRun.urlAfter = currentPageUrl(input.page);
        return stepRun;
      }

      stepRun.executedAction = action;
      if (typeof input.stagehand.act !== "function") {
        throw new Error("stagehand act not available");
      }
      await input.stagehand.act(action);
      input.trace.push({
        timestamp: nowIso(),
        action: "scenario.step.act",
        details: {
          stepId: input.step.stepId,
          instruction: input.step.actionInstruction,
          selector: action.selector,
          method: action.method
        }
      });
    } catch (error) {
      stepRun.message = `Action step failed: ${normalizeExecutionError(error)}`;
      stepRun.urlAfter = currentPageUrl(input.page);
      return stepRun;
    }
  }

  for (const assertion of input.step.assertions) {
    const assertionRun = await executeScenarioAssertion({
      stagehand: input.stagehand,
      assertion,
      step: input.step,
      trace: input.trace
    });
    stepRun.assertionRuns.push(assertionRun);

    if (!assertionRun.success) {
      stepRun.message = assertionRun.error ?? assertionRun.message;
      stepRun.urlAfter = currentPageUrl(input.page);
      input.trace.push({
        timestamp: nowIso(),
        action: "scenario.step.failed",
        details: {
          stepId: input.step.stepId,
          assertionId: assertionRun.assertionId,
          message: stepRun.message
        }
      });
      return stepRun;
    }
  }

  stepRun.success = true;
  stepRun.message = `Step passed (${input.step.assertions.length} assertion${input.step.assertions.length === 1 ? "" : "s"}).`;
  stepRun.urlAfter = currentPageUrl(input.page);
  input.trace.push({
    timestamp: nowIso(),
    action: "scenario.step.passed",
    details: {
      stepId: input.step.stepId,
      assertions: input.step.assertions.length
    }
  });
  return stepRun;
}

export async function executeScenarioSteps(input: {
  stagehand: any;
  page: any;
  scenario: RunScenarioInput["scenario"];
  trace: ScenarioRunResult["trace"];
}): Promise<{
  success: boolean;
  message: string;
  stepRuns: ScenarioStepRun[];
}> {
  const stepRuns: ScenarioStepRun[] = [];

  for (const step of input.scenario.steps) {
    const stepRun = await executeScenarioStep({
      stagehand: input.stagehand,
      page: input.page,
      step,
      trace: input.trace
    });
    stepRuns.push(stepRun);
    if (!stepRun.success) {
      return {
        success: false,
        message: `Step ${step.stepId} failed: ${stepRun.message}`,
        stepRuns
      };
    }
  }

  return {
    success: true,
    message: `Scenario passed (${input.scenario.steps.length} step${input.scenario.steps.length === 1 ? "" : "s"}).`,
    stepRuns
  };
}

function pickReplacementAction(
  previous: ActionCacheEntry,
  refreshedEntries: ActionCacheEntry[]
): ActionCacheEntry | undefined {
  return refreshedEntries
    .map((entry) => {
      let score = 0;
      if ((entry.method ?? "click") === (previous.method ?? "click")) {
        score += 10;
      }
      if (entry.description === previous.description) {
        score += 20;
      } else if (
        entry.description.toLowerCase().includes(previous.description.toLowerCase()) ||
        previous.description.toLowerCase().includes(entry.description.toLowerCase())
      ) {
        score += 10;
      }
      if (entry.arguments.join("|") === previous.arguments.join("|")) {
        score += 5;
      }
      return { entry, score };
    })
    .sort((left, right) => right.score - left.score || left.entry.description.localeCompare(right.entry.description))
    .at(0)?.entry;
}

export class StagehandAutomationRunner implements AutomationRunner {
  constructor(private readonly stagehandEnv: string = "LOCAL") {}

  async runScenario(input: RunScenarioInput): Promise<ScenarioRunResult> {
    const started = Date.now();
    const trace: ScenarioRunResult["trace"] = [];
    const usagePhase = input.usagePhase ?? "guided_scenario";
    const allAiCalls: AiUsageRecord[] = [];
    const usageSummaries: AiUsageSummary[] = [];
    let stagehand: any | undefined;

    for (let attempt = 0; attempt <= input.runConfig.retryCount; attempt += 1) {
      const cooldownDelayMs = getOpenRouterModelCooldownDelay(input.model.id);
      if (cooldownDelayMs > 0) {
        trace.push({
          timestamp: nowIso(),
          action: "model.cooldown_wait",
          details: {
            attempt,
            modelId: input.model.id,
            delayMs: cooldownDelayMs
          }
        });
        await delay(cooldownDelayMs);
      }

      const stagehandLogs: StagehandLogLine[] = [];
      const attemptAiCalls: AiUsageRecord[] = [];
      let history: StagehandHistoryEntry[] = [];
      try {
        const { Stagehand } = await import("@browserbasehq/stagehand");
        stagehand = new Stagehand(
          buildStagehandConfig(this.stagehandEnv, {
            model: input.model,
            runConfig: input.runConfig,
            cacheConfig: input.cacheConfig,
            usagePhase,
            usageSink: attemptAiCalls,
            logger: createStagehandLogCollector(stagehandLogs)
          })
        );
        await stagehand.init();
        const page =
          stagehand.page ??
          stagehand.context?.pages?.()[0] ??
          stagehand.context?.newPage?.();
        if (!page) {
          throw new Error("stagehand page not available after initialization");
        }

        await page.setViewportSize?.(input.runConfig.viewport);
        trace.push({
          timestamp: nowIso(),
          action: "set_viewport",
          details: {
            width: input.runConfig.viewport.width,
            height: input.runConfig.viewport.height
          }
        });

        await page.goto(input.aut.url, {
          timeout: input.runConfig.timeoutMs,
          waitUntil: "domcontentloaded"
        });
        trace.push({
          timestamp: nowIso(),
          action: "goto",
          details: { url: input.aut.url, attempt }
        });

        const execution = await executeScenarioSteps({
          stagehand,
          page,
          scenario: input.scenario,
          trace,
        });
        const pageSnapshot = await snapshotPage(page);
        const metrics = await readStagehandMetrics(stagehand);
        history = await readStagehandHistory(stagehand);
        const cache = buildScenarioCacheTelemetry({
          cacheConfig: input.cacheConfig,
          metrics,
          logs: stagehandLogs
        });

        appendCacheTrace(trace, cache);
        appendHistoryTrace(trace, history);
        const attemptUsageSummary = buildAttemptUsageSummary({
          aiCalls: attemptAiCalls,
          metrics
        });
        allAiCalls.push(...attemptAiCalls);
        usageSummaries.push(attemptUsageSummary);
        const usageSummary = sumAiUsageSummaries(usageSummaries);

        await stagehand.close?.();
        return {
          scenarioId: input.scenario.scenarioId,
          scenarioTitle: input.scenario.title,
          trial: input.trial,
          modelId: input.model.id,
          success: execution.success,
          message: execution.message,
          latencyMs: Date.now() - started,
          costUsd: usageSummary.costUsd,
          usageSummary,
          aiCalls: [...allAiCalls],
          urlAfter: pageSnapshot.url,
          screenshotBase64: pageSnapshot.screenshotBase64,
          domSnapshot: pageSnapshot.domSnapshot,
          trace,
          historyEntries: history,
          cache,
          stepRuns: execution.stepRuns
        };
      } catch (error) {
        const metrics = await readStagehandMetrics(stagehand);
        history = await readStagehandHistory(stagehand);
        appendHistoryTrace(trace, history);
        const cache = buildScenarioCacheTelemetry({
          cacheConfig: input.cacheConfig,
          metrics,
          logs: stagehandLogs
        });
        appendCacheTrace(trace, cache);
        const attemptUsageSummary = buildAttemptUsageSummary({
          aiCalls: attemptAiCalls,
          metrics
        });
        allAiCalls.push(...attemptAiCalls);
        usageSummaries.push(attemptUsageSummary);
        const errorMessage = normalizeExecutionError(error);
        const retryDelayMs = computeRetryDelayMs({
          attempt,
          modelId: input.model.id,
          errorMessage
        });
        if (retryDelayMs > 0) {
          applyOpenRouterModelCooldown(input.model.id, retryDelayMs);
        }

        trace.push({
          timestamp: nowIso(),
          action: "error",
          details: {
            attempt,
            message: errorMessage
          }
        });
        await stagehand?.close?.();
        if (attempt >= input.runConfig.retryCount) {
          const usageSummary = sumAiUsageSummaries(usageSummaries);
          return {
            scenarioId: input.scenario.scenarioId,
            scenarioTitle: input.scenario.title,
            trial: input.trial,
            modelId: input.model.id,
            success: false,
            message: "scenario execution failed after retries",
            latencyMs: Date.now() - started,
            costUsd: usageSummary.costUsd,
            usageSummary,
            aiCalls: [...allAiCalls],
            trace,
            historyEntries: history,
            cache,
            error: errorMessage,
            stepRuns: []
          };
        }

        if (retryDelayMs > 0) {
          trace.push({
            timestamp: nowIso(),
            action: "retry_backoff",
            details: {
              attempt,
              delayMs: retryDelayMs,
              reason: errorMessage
            }
          });
          await delay(retryDelayMs);
        }
      }
    }

    return {
      scenarioId: input.scenario.scenarioId,
      scenarioTitle: input.scenario.title,
      trial: input.trial,
      modelId: input.model.id,
      success: false,
      message: "unexpected execution state",
      latencyMs: Date.now() - started,
      costUsd: undefined,
      usageSummary: sumAiUsageSummaries(usageSummaries),
      aiCalls: [...allAiCalls],
      trace,
      cache: buildScenarioCacheTelemetry({
        cacheConfig: input.cacheConfig,
        metrics: undefined,
        logs: []
      }),
      stepRuns: []
    };
  }

  async exploreTarget(input: {
    model: RunScenarioInput["model"];
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: RunScenarioInput["aut"];
    runConfig: RunScenarioInput["runConfig"];
    cacheConfig: RunScenarioInput["cacheConfig"];
    workspacePath: string;
  }): Promise<ExplorationArtifact> {
    const trace: OperationTrace[] = [];
    const coverageGraph = new CoverageGraph();
    const pages = new Map<string, ExplorationArtifact["pages"][number]>();
    const executedActionIds = new Set<string>();
    const cacheEvents: CacheTelemetry[] = [];
    const aiCalls: AiUsageRecord[] = [];
    let actionCache: ActionCacheEntry[] = [];
    let observeCache: ObserveCacheEntry[] = [];
    let stagehand: any | undefined;
    const startedAt = nowIso();
    const explorationRunId = `explore-${input.targetId}-${Date.now()}-${input.model.id.replace(/[^\w-]+/g, "_")}`;

    try {
      observeCache = await loadObserveCache(input.cacheConfig);
      const { Stagehand } = await import("@browserbasehq/stagehand");
      stagehand = new Stagehand(
        buildStagehandConfig(this.stagehandEnv, {
          model: input.model,
          runConfig: input.runConfig,
          cacheConfig: input.cacheConfig,
          usagePhase: "exploration",
          usageSink: aiCalls
        })
      );
      await stagehand.init();
      const page =
        stagehand.page ??
        stagehand.context?.pages?.()[0] ??
        stagehand.context?.newPage?.();
      if (!page) {
        throw new Error("stagehand page not available after initialization");
      }

      await page.setViewportSize?.(input.runConfig.viewport);
      await page.goto(input.aut.url, {
        timeout: input.runConfig.timeoutMs,
        waitUntil: "domcontentloaded"
      });
      trace.push({
        timestamp: nowIso(),
        action: "explore.goto",
        details: { url: input.aut.url, prompt: input.prompt }
      });

      for (let step = 0; step < input.runConfig.maxSteps; step += 1) {
        const pageSnapshot = await snapshotPage(page);
        const fingerprint = fingerprintState({
          url: pageSnapshot.url || input.aut.url,
          domSnapshot: pageSnapshot.domSnapshot,
          screenshotBase64: pageSnapshot.screenshotBase64
        });
        const currentStateId = coverageGraph.upsertState({
          url: pageSnapshot.url || input.aut.url,
          domSnapshot: pageSnapshot.domSnapshot,
          screenshotBase64: pageSnapshot.screenshotBase64
        });
        const observeInstruction = buildExplorationObserveInstruction(input.prompt);

        let observeWarnings: string[] = [];
        let observeCacheStatus: CacheStatus;
        let observedActions: ObservedAction[] = [];

        const cachedObservation = findObserveCacheEntry(observeCache, {
          instruction: observeInstruction,
          url: pageSnapshot.url || input.aut.url,
          stateId: currentStateId,
          domHash: fingerprint.domHash,
          visualHash: fingerprint.visualHash
        });

        if (cachedObservation) {
          observeCacheStatus = "hit";
          observedActions = cachedObservation.actions;
          observeCache = markObserveCacheHit(observeCache, cachedObservation.entryId);
          await saveObserveCache(input.cacheConfig, observeCache);
          trace.push({
            timestamp: nowIso(),
            action: "explore.observe",
            details: {
              step,
              stateId: currentStateId,
              source: "cache",
              actionsDiscovered: observedActions.length
            }
          });
        } else {
          observeCacheStatus = "miss";
          observedActions = normalizeObservedActions(
            typeof stagehand.observe === "function" ? await stagehand.observe(observeInstruction) : []
          );
          observeCache = upsertObserveCacheEntry(observeCache, {
            instruction: observeInstruction,
            url: pageSnapshot.url || input.aut.url,
            stateId: currentStateId,
            domHash: fingerprint.domHash,
            visualHash: fingerprint.visualHash,
            actions: observedActions
          });
          await saveObserveCache(input.cacheConfig, observeCache);
          trace.push({
            timestamp: nowIso(),
            action: "explore.observe",
            details: {
              step,
              stateId: currentStateId,
              source: "model",
              actionsDiscovered: observedActions.length
            }
          });
        }

        const currentPage = pages.get(currentStateId);
        if (currentPage) {
          currentPage.visitCount += 1;
          currentPage.summary = pageSnapshot.summary;
          currentPage.availableActions = observedActions;
        } else {
          pages.set(currentStateId, {
            id: currentStateId,
            url: pageSnapshot.url || input.aut.url,
            domHash: fingerprint.domHash,
            visualHash: fingerprint.visualHash,
            summary: pageSnapshot.summary,
            availableActions: observedActions,
            visitCount: 1
          });
        }

        const stateEntries = buildActionCacheEntries({
          stateId: currentStateId,
          url: pageSnapshot.url || input.aut.url,
          domHash: fingerprint.domHash,
          visualHash: fingerprint.visualHash,
          actions: observedActions,
          instructionHint: input.prompt
        });
        actionCache = updateStateActionCache(actionCache, currentStateId, stateEntries);

        const nextAction = chooseExplorationAction(actionCache, executedActionIds, currentStateId);
        if (!nextAction) {
          cacheEvents.push(
            buildObserveCacheTelemetry({
              cacheConfig: input.cacheConfig,
              status: observeCacheStatus,
              warnings: observeWarnings
            })
          );
          trace.push({
            timestamp: nowIso(),
            action: "explore.complete",
            details: {
              reason: "no_untried_actions",
              stateId: currentStateId
            }
          });
          break;
        }

        const beforeStateId = currentStateId;
        let executedEntry = nextAction;
        let actionSucceeded = false;

        try {
          if (typeof stagehand.act !== "function") {
            throw new Error("stagehand act not available");
          }
          await stagehand.act(buildExecutableAction(nextAction, step));
          actionSucceeded = true;
        } catch (error) {
          trace.push({
            timestamp: nowIso(),
            action: "explore.act_error",
            details: {
              step,
              actionId: nextAction.actionId,
              message: error instanceof Error ? error.message : String(error)
            }
          });

          if (observeCacheStatus === "hit" && typeof stagehand.observe === "function" && typeof stagehand.act === "function") {
            const refreshedObservedActions = normalizeObservedActions(await stagehand.observe(observeInstruction));
            observeCache = upsertObserveCacheEntry(observeCache, {
              instruction: observeInstruction,
              url: pageSnapshot.url || input.aut.url,
              stateId: currentStateId,
              domHash: fingerprint.domHash,
              visualHash: fingerprint.visualHash,
              actions: refreshedObservedActions
            });
            await saveObserveCache(input.cacheConfig, observeCache);
            observeCacheStatus = "refreshed_after_failure";
            observeWarnings = [
              `Cached observed action failed for "${nextAction.description}" and observe() refreshed the page action set.`
            ];

            const refreshedEntries = buildActionCacheEntries({
              stateId: currentStateId,
              url: pageSnapshot.url || input.aut.url,
              domHash: fingerprint.domHash,
              visualHash: fingerprint.visualHash,
              actions: refreshedObservedActions,
              instructionHint: input.prompt
            });
            actionCache = updateStateActionCache(actionCache, currentStateId, refreshedEntries);

            const replacement = pickReplacementAction(nextAction, refreshedEntries);
            if (replacement) {
              executedEntry = replacement;
              await stagehand.act(buildExecutableAction(replacement, step));
              actionSucceeded = true;
              trace.push({
                timestamp: nowIso(),
                action: "explore.observe_refresh",
                details: {
                  step,
                  previousActionId: nextAction.actionId,
                  nextActionId: replacement.actionId
                }
              });
            }
          }
        }

        cacheEvents.push(
          buildObserveCacheTelemetry({
            cacheConfig: input.cacheConfig,
            status: observeCacheStatus,
            warnings: observeWarnings
          })
        );

        if (!actionSucceeded) {
          trace.push({
            timestamp: nowIso(),
            action: "explore.complete",
            details: {
              reason: "action_failed",
              stateId: currentStateId,
              actionId: executedEntry.actionId
            }
          });
          break;
        }

        executedActionIds.add(executedEntry.actionId);
        actionCache = markExecutedActions(actionCache, [executedEntry.actionId], input.prompt);

        const afterSnapshot = await snapshotPage(page);
        const afterStateId = coverageGraph.upsertState({
          url: afterSnapshot.url || input.aut.url,
          domSnapshot: afterSnapshot.domSnapshot,
          screenshotBase64: afterSnapshot.screenshotBase64
        });
        coverageGraph.addTransition(beforeStateId, afterStateId, executedEntry.description);
        trace.push({
          timestamp: nowIso(),
          action: "explore.act",
          details: {
            step,
            actionId: executedEntry.actionId,
            description: executedEntry.description,
            stateId: beforeStateId,
            nextStateId: afterStateId
          }
        });

        if (beforeStateId === afterStateId) {
          await page.goto(input.aut.url, {
            timeout: input.runConfig.timeoutMs,
            waitUntil: "domcontentloaded"
          });
          trace.push({
            timestamp: nowIso(),
            action: "explore.backtrack",
            details: {
              step,
              reason: "loop_detected",
              url: input.aut.url
            }
          });
        }
      }

      const history = await readStagehandHistory(stagehand);
      const metrics = await readStagehandMetrics(stagehand);
      appendHistoryTrace(trace, history);
      const finishedAt = nowIso();
      const usageSummary = buildAttemptUsageSummary({
        aiCalls,
        metrics
      });

      await stagehand.close?.();
      return {
        explorationRunId,
        targetId: input.targetId,
        bugIds: input.bugIds,
        modelId: input.model.id,
        trial: input.trial,
        prompt: input.prompt,
        workspacePath: input.workspacePath,
        startedAt,
        finishedAt,
        compatibility: {
          targetId: input.targetId,
          bugIds: input.bugIds,
          viewport: input.runConfig.viewport
        },
        history,
        pages: [...pages.values()],
        coverageGraph: coverageGraph.snapshot(),
        observeCache,
        actionCache,
        cacheSummary: summarizeCacheTelemetry(cacheEvents),
        usageSummary,
        aiCalls: [...aiCalls],
        trace,
        summary: {
          statesDiscovered: pages.size,
          transitionsDiscovered: coverageGraph.snapshot().edges.length,
          actionsCached: actionCache.length,
          observeCacheEntries: observeCache.length,
          historyEntries: history.length
        }
      };
    } catch (error) {
      trace.push({
        timestamp: nowIso(),
        action: "explore.error",
        details: { message: error instanceof Error ? error.message : String(error) }
      });
      const metrics = await readStagehandMetrics(stagehand);
      await stagehand?.close?.();
      const finishedAt = nowIso();
      const usageSummary = buildAttemptUsageSummary({
        aiCalls,
        metrics
      });
      return {
        explorationRunId,
        targetId: input.targetId,
        bugIds: input.bugIds,
        modelId: input.model.id,
        trial: input.trial,
        prompt: input.prompt,
        workspacePath: input.workspacePath,
        startedAt,
        finishedAt,
        compatibility: {
          targetId: input.targetId,
          bugIds: input.bugIds,
          viewport: input.runConfig.viewport
        },
        history: [],
        pages: [],
        coverageGraph: { nodes: [], edges: [] },
        observeCache,
        actionCache: [],
        cacheSummary: summarizeCacheTelemetry(cacheEvents),
        usageSummary,
        aiCalls: [...aiCalls],
        trace,
        summary: {
          statesDiscovered: 0,
          transitionsDiscovered: 0,
          actionsCached: 0,
          observeCacheEntries: observeCache.length,
          historyEntries: 0
        }
      };
    }
  }
}
