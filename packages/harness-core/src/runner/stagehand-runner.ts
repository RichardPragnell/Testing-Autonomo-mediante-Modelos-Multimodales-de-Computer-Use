import { buildActionCacheEntries, markExecutedActions } from "../exploration/action-cache.js";
import { CoverageGraph, fingerprintState } from "../graph/state-graph.js";
import { evaluateExpectation } from "./expectations.js";
import type {
  ActionCacheEntry,
  AutomationRunner,
  ExplorationArtifact,
  ObservedAction,
  OperationTrace,
  RunTaskInput,
  StagehandHistoryEntry,
  TaskRunResult
} from "../types.js";
import { nowIso } from "../utils/time.js";

function estimateCostUsd(metrics: any): number {
  if (!metrics) {
    return 0;
  }
  const promptTokens = Number(metrics.totalPromptTokens ?? 0);
  const completionTokens = Number(metrics.totalCompletionTokens ?? 0);
  const totalTokens = promptTokens + completionTokens;
  return Number((totalTokens * 0.000001).toFixed(6));
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

function buildLocalBrowserLaunchOptions(input: RunTaskInput): Record<string, unknown> {
  const options: Record<string, unknown> = {
    viewport: input.runConfig.viewport
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

function buildStagehandConfig(stagehandEnv: string, input: { model: RunTaskInput["model"]; runConfig: RunTaskInput["runConfig"] }): any {
  const apiKey = process.env[input.model.envKey];
  const config: any = {
    env: stagehandEnv as any,
    model: apiKey
      ? {
          modelName: input.model.id,
          apiKey
        }
      : input.model.id
  };

  if (stagehandEnv === "LOCAL") {
    config.localBrowserLaunchOptions = {
      ...buildLocalBrowserLaunchOptions({
        model: input.model,
        task: {
          id: "noop",
          instruction: "",
          expected: { type: "text_visible", value: "" },
          source: "synthetic"
        },
        trial: 1,
        aut: { url: "http://127.0.0.1" },
        runConfig: input.runConfig
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

function buildCacheHintInstruction(taskInstruction: string, cacheHints: ActionCacheEntry[]): string {
  if (!cacheHints.length) {
    return taskInstruction;
  }

  const hintText = cacheHints
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.method ?? "click"} ${entry.description} via ${entry.selector}${entry.arguments.length ? ` args=${entry.arguments.join(", ")}` : ""}`
    )
    .join("\n");

  return `Known reusable actions for this page:\n${hintText}\n\nTask: ${taskInstruction}`;
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

function chooseExplorationAction(actionCache: ActionCacheEntry[], executedActionIds: Set<string>, stateId: string): ActionCacheEntry | undefined {
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

export class StagehandAutomationRunner implements AutomationRunner {
  constructor(private readonly stagehandEnv: string = "LOCAL") {}

  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const started = Date.now();
    const trace: TaskRunResult["trace"] = [];
    let stagehand: any | undefined;

    for (let attempt = 0; attempt <= input.runConfig.retryCount; attempt += 1) {
      try {
        const { Stagehand } = await import("@browserbasehq/stagehand");
        stagehand = new Stagehand(buildStagehandConfig(this.stagehandEnv, input));
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

        const instruction = buildCacheHintInstruction(input.task.instruction, input.cacheHints ?? []);
        const agent = typeof stagehand.agent === "function"
          ? stagehand.agent({
              model: input.model.id,
              mode: "dom",
              systemPrompt: input.systemPrompt
            })
          : undefined;

        if (agent?.execute) {
          await agent.execute({
            instruction,
            maxSteps: input.runConfig.maxSteps
          });
          trace.push({
            timestamp: nowIso(),
            action: "agent.execute",
            details: {
              instruction: input.task.instruction,
              cacheHints: input.cacheHints?.map((entry) => entry.actionId) ?? [],
              maxSteps: input.runConfig.maxSteps
            }
          });
        } else if (typeof stagehand.act === "function") {
          await stagehand.act(instruction);
          trace.push({
            timestamp: nowIso(),
            action: "act",
            details: {
              instruction: input.task.instruction,
              cacheHints: input.cacheHints?.map((entry) => entry.actionId) ?? []
            }
          });
        }

        const assertion = await evaluateExpectation(page, input.task.expected);
        const pageSnapshot = await snapshotPage(page);
        const metrics = await readStagehandMetrics(stagehand);
        const history = await readStagehandHistory(stagehand);

        appendHistoryTrace(trace, history);

        await stagehand.close?.();
        return {
          taskId: input.task.id,
          trial: input.trial,
          modelId: input.model.id,
          success: assertion.success,
          message: assertion.message,
          latencyMs: Date.now() - started,
          costUsd: estimateCostUsd(metrics),
          urlAfter: assertion.urlAfter ?? pageSnapshot.url,
          screenshotBase64: pageSnapshot.screenshotBase64,
          domSnapshot: pageSnapshot.domSnapshot,
          trace,
          historyEntries: history,
          cacheHints: input.cacheHints
        };
      } catch (error) {
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
          return {
            taskId: input.task.id,
            trial: input.trial,
            modelId: input.model.id,
            success: false,
            message: "task execution failed after retries",
            latencyMs: Date.now() - started,
            costUsd: 0,
            trace,
            error: error instanceof Error ? error.message : String(error),
            cacheHints: input.cacheHints
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
      costUsd: 0,
      trace,
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
    workspacePath: string;
  }): Promise<ExplorationArtifact> {
    const trace: OperationTrace[] = [];
    const coverageGraph = new CoverageGraph();
    const pages = new Map<string, ExplorationArtifact["pages"][number]>();
    const executedActionIds = new Set<string>();
    let actionCache: ActionCacheEntry[] = [];
    let stagehand: any | undefined;
    const startedAt = nowIso();
    const explorationRunId = `explore-${input.targetId}-${Date.now()}-${input.model.id.replace(/[^\w-]+/g, "_")}`;

    try {
      const { Stagehand } = await import("@browserbasehq/stagehand");
      stagehand = new Stagehand(
        buildStagehandConfig(this.stagehandEnv, {
          model: input.model,
          runConfig: input.runConfig
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

      let currentStateId = "";
      for (let step = 0; step < input.runConfig.maxSteps; step += 1) {
        const pageSnapshot = await snapshotPage(page);
        const fingerprint = fingerprintState({
          url: pageSnapshot.url || input.aut.url,
          domSnapshot: pageSnapshot.domSnapshot,
          screenshotBase64: pageSnapshot.screenshotBase64
        });
        currentStateId = coverageGraph.upsertState({
          url: pageSnapshot.url || input.aut.url,
          domSnapshot: pageSnapshot.domSnapshot,
          screenshotBase64: pageSnapshot.screenshotBase64
        });

        const observedActions = normalizeObservedActions(
          typeof stagehand.observe === "function"
            ? await stagehand.observe(
                `Exploration goal: ${input.prompt}\nFind the most useful clickable, toggle, navigation, save, cancel, edit, delete, or fill actions on this page for continuing exploration.`
              )
            : []
        );

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

        actionCache = markExecutedActions(
          actionCache,
          [],
          undefined
        );
        actionCache = [
          ...new Map(
            [
              ...actionCache,
              ...buildActionCacheEntries({
                stateId: currentStateId,
                url: pageSnapshot.url || input.aut.url,
                domHash: fingerprint.domHash,
                visualHash: fingerprint.visualHash,
                actions: observedActions,
                instructionHint: input.prompt
              })
            ].map((entry) => [entry.actionId, entry])
          ).values()
        ];

        trace.push({
          timestamp: nowIso(),
          action: "explore.observe",
          details: {
            step,
            stateId: currentStateId,
            actionsDiscovered: observedActions.length
          }
        });

        const nextAction = chooseExplorationAction(actionCache, executedActionIds, currentStateId);
        if (!nextAction) {
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
        const executableAction = buildExecutableAction(nextAction, step);
        if (typeof stagehand.act === "function") {
          await stagehand.act(executableAction);
        }
        executedActionIds.add(nextAction.actionId);
        actionCache = markExecutedActions(actionCache, [nextAction.actionId], input.prompt);

        const afterSnapshot = await snapshotPage(page);
        const afterStateId = coverageGraph.upsertState({
          url: afterSnapshot.url || input.aut.url,
          domSnapshot: afterSnapshot.domSnapshot,
          screenshotBase64: afterSnapshot.screenshotBase64
        });
        coverageGraph.addTransition(beforeStateId, afterStateId, nextAction.description);
        trace.push({
          timestamp: nowIso(),
          action: "explore.act",
          details: {
            step,
            actionId: nextAction.actionId,
            description: nextAction.description,
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
      appendHistoryTrace(trace, history);
      const finishedAt = nowIso();

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
        actionCache,
        trace,
        summary: {
          statesDiscovered: pages.size,
          transitionsDiscovered: coverageGraph.snapshot().edges.length,
          actionsCached: actionCache.length,
          historyEntries: history.length
        }
      };
    } catch (error) {
      trace.push({
        timestamp: nowIso(),
        action: "explore.error",
        details: { message: error instanceof Error ? error.message : String(error) }
      });
      await stagehand?.close?.();
      const finishedAt = nowIso();
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
        actionCache: [],
        trace,
        summary: {
          statesDiscovered: 0,
          transitionsDiscovered: 0,
          actionsCached: 0,
          historyEntries: 0
        }
      };
    }
  }
}
