import { sha256 } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import type { AutomationRunner, ExplorationArtifact, RunTaskInput, TaskRunResult } from "../types.js";

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
    const cacheStatus = input.trial > 1 ? "hit" : "miss";

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
          details: {
            instruction: input.task.instruction,
            score,
            quality,
            systemPrompt: input.systemPrompt,
            cacheNamespace: input.cacheConfig.namespace,
            cacheStatus
          }
        }
      ],
      cache: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        mode: "agent_native",
        status: cacheStatus,
        aiInvoked: cacheStatus !== "hit",
        warnings: []
      },
      error: success ? undefined : "mock failure"
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
    const explorationRunId = `mock-explore-${this.seed}-${input.trial}`;
    const observeCache = [
      {
        entryId: "observe-root",
        key: sha256(`${input.cacheConfig.namespace}|root`),
        instruction: input.prompt,
        stateId: "state-root",
        url: input.aut.url,
        domHash: sha256("root"),
        visualHash: sha256("root-visual"),
        actions: [
          {
            selector: "button:text(Edit)",
            description: "Edit button for the first todo",
            method: "click",
            arguments: []
          }
        ],
        hitCount: input.trial > 1 ? 1 : 0,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ];

    return {
      explorationRunId,
      targetId: input.targetId,
      bugIds: input.bugIds,
      modelId: input.model.id,
      trial: input.trial,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      compatibility: {
        targetId: input.targetId,
        bugIds: input.bugIds,
        viewport: input.runConfig.viewport
      },
      history: [
        {
          method: "goto",
          parameters: { url: input.aut.url },
          timestamp: nowIso()
        },
        {
          method: "observe",
          parameters: { prompt: input.prompt },
          timestamp: nowIso()
        }
      ],
      pages: [
        {
          id: "state-root",
          url: input.aut.url,
          domHash: sha256("root"),
          visualHash: sha256("root-visual"),
          summary: "Mock root page",
          availableActions: [
            {
              selector: "button:text(Edit)",
              description: "Edit button for the first todo",
              method: "click",
              arguments: []
            }
          ],
          visitCount: 1
        }
      ],
      coverageGraph: {
        nodes: [
          {
            id: "state-root",
            url: input.aut.url,
            domHash: sha256("root"),
            visualHash: sha256("root-visual"),
            visits: 1
          }
        ],
        edges: []
      },
      actionCache: [
        {
          actionId: "action-edit-first",
          stateId: "state-root",
          url: input.aut.url,
          domHash: sha256("root"),
          visualHash: sha256("root-visual"),
          selector: "button:text(Edit)",
          description: "Edit button for the first todo",
          method: "click",
          arguments: [],
          signature: "edit:first",
          instructionHints: [input.prompt, "Edit an existing todo item"],
          observationCount: 1,
          executionCount: 0
        }
      ],
      observeCache,
      cacheSummary: {
        rootDir: input.cacheConfig.rootDir,
        namespace: input.cacheConfig.namespace,
        configSignature: input.cacheConfig.configSignature,
        total: 1,
        hits: input.trial > 1 ? 1 : 0,
        misses: input.trial > 1 ? 0 : 1,
        refreshedAfterFailure: 0,
        aiInvocations: input.trial > 1 ? 0 : 1,
        warnings: [],
        modes: ["observe_manual"]
      },
      trace: [
        {
          timestamp: nowIso(),
          action: "mock.explore",
          details: {
            prompt: input.prompt,
            maxSteps: input.runConfig.maxSteps,
            cacheNamespace: input.cacheConfig.namespace
          }
        }
      ],
      summary: {
        statesDiscovered: 1,
        transitionsDiscovered: 0,
        actionsCached: 1,
        observeCacheEntries: observeCache.length,
        historyEntries: 2
      }
    };
  }
}
