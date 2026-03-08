import { evaluateExpectation } from "./expectations.js";
import type { AutomationRunner, RunTaskInput, TaskRunResult } from "../types.js";
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

async function readStagehandMetrics(stagehand: any): Promise<any> {
  try {
    const metrics = stagehand?.metrics;
    return metrics && typeof metrics.then === "function" ? await metrics : metrics;
  } catch {
    return undefined;
  }
}

async function readStagehandHistory(stagehand: any): Promise<any[]> {
  try {
    const history = stagehand?.history;
    const resolved = history && typeof history.then === "function" ? await history : history;
    return Array.isArray(resolved) ? resolved : [];
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

function buildStagehandConfig(stagehandEnv: string, input: RunTaskInput): any {
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
    config.localBrowserLaunchOptions = buildLocalBrowserLaunchOptions(input);
  }

  return config;
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

        await page.setViewportSize?.(input.runConfig.viewport.width, input.runConfig.viewport.height);
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

        if (typeof stagehand.act === "function") {
          await stagehand.act(input.task.instruction);
          trace.push({
            timestamp: nowIso(),
            action: "act",
            details: { instruction: input.task.instruction }
          });
        }

        const assertion = await evaluateExpectation(page, input.task.expected);
        const screenshot = await page.screenshot?.({ type: "png" });
        const domSnapshot = await page.content?.();
        const metrics = await readStagehandMetrics(stagehand);
        const history = await readStagehandHistory(stagehand);

        for (const item of history) {
          trace.push({
            timestamp: String(item.timestamp ?? nowIso()),
            action: String(item.method ?? "history"),
            details: item.parameters
          });
        }

        await stagehand.close?.();
        return {
          taskId: input.task.id,
          trial: input.trial,
          modelId: input.model.id,
          success: assertion.success,
          message: assertion.message,
          latencyMs: Date.now() - started,
          costUsd: estimateCostUsd(metrics),
          urlAfter: assertion.urlAfter,
          screenshotBase64: screenshot ? Buffer.from(screenshot).toString("base64") : undefined,
          domSnapshot,
          trace
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
      costUsd: 0,
      trace
    };
  }
}
