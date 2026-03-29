import { summarizeCacheTelemetry } from "../cache/summary.js";
import { isGatewayCostTrackingEnabled } from "../ai/gateway.js";
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
import { evaluateExpectation } from "./expectations.js";
import type {
  ActionCacheEntry,
  AiUsagePhase,
  AiUsageRecord,
  AiUsageSummary,
  AutomationRunner,
  CacheMode,
  CacheStatus,
  CacheTelemetry,
  ExplorationArtifact,
  ObserveCacheEntry,
  ObservedAction,
  OperationTrace,
  RunTaskInput,
  StagehandHistoryEntry,
  TaskRunResult
} from "../types.js";
import { nowIso } from "../utils/time.js";
import { StagehandGatewayTrackingClient } from "./stagehand-gateway-client.js";

type StagehandExecutionResult = {
  metadata?: Record<string, unknown>;
};

type StagehandLogLine = {
  category?: string;
  message: string;
  level?: number;
  timestamp?: string;
};

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
  viewport: RunTaskInput["runConfig"]["viewport"];
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
    model: RunTaskInput["model"];
    runConfig: RunTaskInput["runConfig"];
    cacheConfig: RunTaskInput["cacheConfig"];
    usagePhase: AiUsagePhase;
    usageSink: AiUsageRecord[];
    logger?: (line: any) => void;
  }
): any {
  if (!isGatewayCostTrackingEnabled()) {
    throw new Error("AI_GATEWAY_API_KEY is required for Stagehand benchmark execution");
  }

  const config: any = {
    env: stagehandEnv as any,
    model: input.model.id,
    cacheDir: input.cacheConfig.cacheDir,
    selfHeal: true,
    llmClient: new StagehandGatewayTrackingClient({
      modelId: input.model.id,
      provider: input.model.provider,
      phase: input.usagePhase,
      usageSink: input.usageSink
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

function buildGuidedCacheTelemetry(input: {
  cacheConfig: RunTaskInput["cacheConfig"];
  mode: CacheMode;
  metrics: any;
  logs: StagehandLogLine[];
  executionResult?: StagehandExecutionResult;
}): CacheTelemetry {
  const messages = input.logs.map((item) => item.message.toLowerCase());
  const hasHit =
    input.executionResult?.metadata?.cacheHit === true || messages.some((message) => message.includes("cache hit"));
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
    mode: input.mode,
    status,
    aiInvoked: estimateAiInvocation(input.metrics),
    warnings
  };
}

function buildObserveCacheTelemetry(input: {
  cacheConfig: RunTaskInput["cacheConfig"];
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

  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const started = Date.now();
    const trace: TaskRunResult["trace"] = [];
    const usagePhase = input.usagePhase ?? "guided_task";
    const allAiCalls: AiUsageRecord[] = [];
    const usageSummaries: AiUsageSummary[] = [];
    let stagehand: any | undefined;

    for (let attempt = 0; attempt <= input.runConfig.retryCount; attempt += 1) {
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

        let executionMode: CacheMode = "act_native";
        let executionResult: any;
        const agent =
          typeof stagehand.agent === "function"
            ? stagehand.agent({
                model: input.model.id,
                mode: "dom",
                systemPrompt: input.systemPrompt
              })
            : undefined;

        if (agent?.execute) {
          executionMode = "agent_native";
          executionResult = await agent.execute({
            instruction: input.task.instruction,
            maxSteps: input.runConfig.maxSteps
          });
          trace.push({
            timestamp: nowIso(),
            action: "agent.execute",
            details: {
              instruction: input.task.instruction,
              maxSteps: input.runConfig.maxSteps,
              cacheNamespace: input.cacheConfig.namespace
            }
          });
        } else if (typeof stagehand.act === "function") {
          executionMode = "act_native";
          executionResult = await stagehand.act(input.task.instruction);
          trace.push({
            timestamp: nowIso(),
            action: "act",
            details: {
              instruction: input.task.instruction,
              cacheNamespace: input.cacheConfig.namespace
            }
          });
        } else {
          throw new Error("stagehand execution primitive not available");
        }

        const assertion = await evaluateExpectation(page, input.task.expected);
        const pageSnapshot = await snapshotPage(page);
        const metrics = await readStagehandMetrics(stagehand);
        history = await readStagehandHistory(stagehand);
        const cache = buildGuidedCacheTelemetry({
          cacheConfig: input.cacheConfig,
          mode: executionMode,
          metrics,
          logs: stagehandLogs,
          executionResult
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
          taskId: input.task.id,
          trial: input.trial,
          modelId: input.model.id,
          success: assertion.success,
          message: assertion.message,
          latencyMs: Date.now() - started,
          costUsd: usageSummary.costUsd,
          usageSummary,
          aiCalls: [...allAiCalls],
          urlAfter: assertion.urlAfter ?? pageSnapshot.url,
          screenshotBase64: pageSnapshot.screenshotBase64,
          domSnapshot: pageSnapshot.domSnapshot,
          trace,
          historyEntries: history,
          cache,
          cacheHints: input.cacheHints
        };
      } catch (error) {
        const metrics = await readStagehandMetrics(stagehand);
        history = await readStagehandHistory(stagehand);
        appendHistoryTrace(trace, history);
        const cache = buildGuidedCacheTelemetry({
          cacheConfig: input.cacheConfig,
          mode: "agent_native",
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

        trace.push({
          timestamp: nowIso(),
          action: "error",
          details: {
            attempt,
            message: error instanceof Error ? error.message : String(error)
          }
        });
        await stagehand?.close?.();
        if (attempt >= input.runConfig.retryCount) {
          const usageSummary = sumAiUsageSummaries(usageSummaries);
          return {
            taskId: input.task.id,
            trial: input.trial,
            modelId: input.model.id,
            success: false,
            message: "task execution failed after retries",
            latencyMs: Date.now() - started,
            costUsd: usageSummary.costUsd,
            usageSummary,
            aiCalls: [...allAiCalls],
            trace,
            historyEntries: history,
            cache,
            cacheHints: input.cacheHints,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success: false,
      message: "unexpected execution state",
      latencyMs: Date.now() - started,
      costUsd: undefined,
      usageSummary: sumAiUsageSummaries(usageSummaries),
      aiCalls: [...allAiCalls],
      trace,
      cache: buildGuidedCacheTelemetry({
        cacheConfig: input.cacheConfig,
        mode: "agent_native",
        metrics: undefined,
        logs: []
      }),
      cacheHints: input.cacheHints
    };
  }

  async exploreTarget(input: {
    model: RunTaskInput["model"];
    trial: number;
    targetId: string;
    bugIds: string[];
    prompt: string;
    aut: RunTaskInput["aut"];
    runConfig: RunTaskInput["runConfig"];
    cacheConfig: RunTaskInput["cacheConfig"];
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
