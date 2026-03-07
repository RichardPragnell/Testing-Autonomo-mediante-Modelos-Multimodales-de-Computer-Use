import { sha256 } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import type { AutomationRunner, RunTaskInput, TaskRunResult } from "../types.js";

function seededNumber(seedText: string): number {
  const hex = sha256(seedText).slice(0, 12);
  return parseInt(hex, 16) / 0xffffffffffff;
}

function baseModelQuality(modelId: string): number {
  if (modelId.includes("pro")) {
    return 0.92;
  }
  if (modelId.includes("gpt-4o")) {
    return 0.89;
  }
  if (modelId.includes("sonnet")) {
    return 0.87;
  }
  if (modelId.includes("flash")) {
    return 0.85;
  }
  return 0.8;
}

export class MockAutomationRunner implements AutomationRunner {
  constructor(private readonly seed = 42) {}

  async runTask(input: RunTaskInput): Promise<TaskRunResult> {
    const started = Date.now();
    const score = seededNumber(
      `${this.seed}|${input.model.id}|${input.task.id}|${input.trial}|${input.aut.url}`
    );
    const quality = baseModelQuality(input.model.id);
    const success = score <= quality;
    const latencyMs = Math.round(800 + score * 2200);
    const costUsd = Number((0.002 + score * 0.008).toFixed(6));
    const message = success ? "mock assertion passed" : "mock assertion failed";
    const domSnapshot = `<html><body><h1>${success ? input.task.expected.value : "Mismatch"}</h1></body></html>`;
    const screenshotBase64 = Buffer.from(
      `${input.model.id}:${input.task.id}:${input.trial}:${success ? "ok" : "ko"}`
    ).toString("base64");

    return {
      taskId: input.task.id,
      trial: input.trial,
      modelId: input.model.id,
      success,
      message,
      latencyMs,
      costUsd,
      urlAfter: success ? `${input.aut.url}/docs` : input.aut.url,
      screenshotBase64,
      domSnapshot,
      trace: [
        { timestamp: nowIso(), action: "mock.goto", details: { url: input.aut.url } },
        {
          timestamp: nowIso(),
          action: "mock.act",
          details: { instruction: input.task.instruction, score, quality }
        }
      ],
      error: success ? undefined : "mock failure"
    };
  }
}

