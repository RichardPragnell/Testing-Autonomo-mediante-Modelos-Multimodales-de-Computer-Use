import { describe, expect, it, vi } from "vitest";
import {
  computeRetryDelayMs,
  executeGuidedStepLoop,
  executeGuidedTaskAttempt,
  normalizeExecutionError
} from "../../src/runner/stagehand-runner.js";

function createPage(initialText: string) {
  const state = {
    text: initialText,
    url: "http://127.0.0.1:3101/",
    dom: `<html><body>${initialText}</body></html>`
  };

  return {
    state,
    page: {
      url: () => state.url,
      content: async () => state.dom,
      screenshot: async () => Buffer.from(state.dom),
      evaluate: async () => state.text
    }
  };
}

const task = {
  id: "guided-edit-task",
  instruction: "Edit the existing task so it reads Done.",
  expected: {
    type: "text_visible" as const,
    value: "Done"
  },
  source: "generated" as const
};

describe("stagehand runner guided helpers", () => {
  it("promotes a nested provider cause over the generic wrapper message", () => {
    const cause = {
      message: "Rate limit exceeded: free-models-per-min. ",
      details: "429 Too Many Requests"
    };
    const error = Object.assign(new Error("Provider returned error"), { cause });

    expect(normalizeExecutionError(error)).toBe("Rate limit exceeded: free-models-per-min.");
  });

  it("extracts nested OpenRouter privacy failures from wrapped retry errors", () => {
    const error = Object.assign(
      new Error("Failed after 2 attempts with non-retryable error: 'Provider returned error'"),
      {
        cause: {
          error: {
            message:
              "No endpoints available matching your guardrail restrictions and data policy. Configure: https://openrouter.ai/settings/privacy"
          }
        }
      }
    );

    expect(normalizeExecutionError(error)).toContain("No endpoints available matching your guardrail restrictions");
  });

  it("uses longer retry delays for free-model rate limits than generic provider errors", () => {
    const rateLimitDelay = computeRetryDelayMs({
      attempt: 0,
      modelId: "google/gemma-3-27b-it:free",
      errorMessage: "Rate limit exceeded: free-models-per-min.",
      env: {}
    });
    const providerDelay = computeRetryDelayMs({
      attempt: 0,
      modelId: "google/gemma-3-27b-it:free",
      errorMessage: "Provider returned error",
      env: {}
    });

    expect(rateLimitDelay).toBeGreaterThan(providerDelay);
    expect(providerDelay).toBeGreaterThan(0);
  });

  it("exits the guided step loop as soon as the expectation passes", async () => {
    const trace: Array<{ action: string }> = [];
    const { state, page } = createPage("Initial");
    const act = vi.fn(async () => {
      state.text = "Done";
      state.dom = "<html><body>Done</body></html>";
    });

    const result = await executeGuidedStepLoop({
      stagehand: { act },
      page,
      task,
      autUrl: "http://127.0.0.1:3101/",
      runConfig: {
        profile: "fast",
        timeoutMs: 45_000,
        retryCount: 0,
        maxSteps: 5,
        maxOutputTokens: 300,
        viewport: { width: 1280, height: 720 }
      },
      trace: trace as never,
      cacheNamespace: "qa-cache"
    });

    expect(result.assertion.success).toBe(true);
    expect(act).toHaveBeenCalledTimes(1);
    expect(trace.filter((entry) => entry.action === "act")).toHaveLength(1);
  });

  it("stops early when repeated actions make no progress", async () => {
    const trace: Array<{ action: string }> = [];
    const { page } = createPage("Still initial");
    const act = vi.fn(async () => undefined);

    const result = await executeGuidedStepLoop({
      stagehand: { act },
      page,
      task,
      autUrl: "http://127.0.0.1:3101/",
      runConfig: {
        profile: "fast",
        timeoutMs: 45_000,
        retryCount: 0,
        maxSteps: 5,
        maxOutputTokens: 300,
        viewport: { width: 1280, height: 720 }
      },
      trace: trace as never,
      cacheNamespace: "qa-cache"
    });

    expect(result.assertion.success).toBe(false);
    expect(act).toHaveBeenCalledTimes(2);
    expect(trace.some((entry) => entry.action === "guided.loop_abort")).toBe(true);
  });

  it("uses agent fallback only after the guided step loop fails", async () => {
    const trace: Array<{ action: string }> = [];
    const { state, page } = createPage("Initial");
    const act = vi.fn(async () => undefined);
    const execute = vi.fn(async () => {
      state.text = "Done";
      state.dom = "<html><body>Done</body></html>";
      return { ok: true };
    });

    const result = await executeGuidedTaskAttempt({
      stagehand: {
        act,
        agent: () => ({
          execute
        })
      },
      page,
      modelId: "z-ai/glm-4-32b",
      systemPrompt: "Be concise",
      task,
      autUrl: "http://127.0.0.1:3101/",
      runConfig: {
        profile: "full",
        timeoutMs: 90_000,
        retryCount: 1,
        maxSteps: 5,
        maxOutputTokens: 600,
        viewport: { width: 1280, height: 720 }
      },
      trace: trace as never,
      cacheNamespace: "qa-cache",
      allowAgentFallback: true
    });

    expect(act).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(trace.findIndex((entry) => entry.action === "guided.loop_abort")).toBeLessThan(
      trace.findIndex((entry) => entry.action === "agent.execute")
    );
    expect(result.executionMode).toBe("agent_native");
    expect(result.assertion.success).toBe(true);
  });
});
