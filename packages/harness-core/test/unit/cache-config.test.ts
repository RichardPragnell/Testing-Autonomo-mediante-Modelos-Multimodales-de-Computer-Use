import { describe, expect, it } from "vitest";
import { buildStagehandConfigSignature, resolveExecutionCacheConfig } from "../../src/cache/config.js";

describe("execution cache config", () => {
  it("isolates cache namespaces per model", async () => {
    const configSignature = buildStagehandConfigSignature({
      executionKind: "guided",
      systemPrompt: "Complete the todo task."
    });

    const first = await resolveExecutionCacheConfig({
      resultsDir: "results",
      targetId: "todo-react",
      bugIds: [],
      viewport: { width: 1280, height: 720 },
      modelId: "mistralai/mistral-small-3.2-24b-instruct",
      configSignature
    });
    const second = await resolveExecutionCacheConfig({
      resultsDir: "results",
      targetId: "todo-react",
      bugIds: [],
      viewport: { width: 1280, height: 720 },
      modelId: "qwen/qwen3.5-flash-02-23",
      configSignature
    });

    expect(first.namespace).not.toBe(second.namespace);
    expect(first.cacheDir).not.toBe(second.cacheDir);
  });
});
