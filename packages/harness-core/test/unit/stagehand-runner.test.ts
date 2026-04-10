import { describe, expect, it, vi } from "vitest";
import { computeRetryDelayMs, executeScenarioSteps, normalizeExecutionError } from "../../src/runner/stagehand-runner.js";

function createPage(url = "http://127.0.0.1:3101/") {
  return {
    url: () => url,
    content: async () => "<html><body>Todo Bench</body></html>",
    screenshot: async () => Buffer.from("screenshot")
  };
}

describe("stagehand runner scenario helpers", () => {
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
      modelId: "test/free-model:free",
      errorMessage: "Rate limit exceeded: free-models-per-min.",
      env: {}
    });
    const providerDelay = computeRetryDelayMs({
      attempt: 0,
      modelId: "test/free-model:free",
      errorMessage: "Provider returned error",
      env: {}
    });

    expect(rateLimitDelay).toBeGreaterThan(providerDelay);
    expect(providerDelay).toBeGreaterThan(0);
  });

  it("passes observe assertions when a matching action exists", async () => {
    const trace: Array<{ action: string }> = [];
    const observe = vi.fn(async () => [{ selector: "button.remove", description: "Remove task button", method: "click" }]);

    const result = await executeScenarioSteps({
      stagehand: { observe },
      page: createPage(),
      scenario: {
        scenarioId: "create-delete-task",
        title: "Delete a task",
        source: "generated",
        steps: [
          {
            stepId: "create-delete-task.observe-remove",
            title: "Confirm the remove control exists",
            assertions: [
              {
                assertionId: "create-delete-task.remove-visible",
                type: "observe",
                instruction: "find the Remove button for the task Remove benchmark draft",
                exists: true,
                method: "click"
              }
            ]
          }
        ]
      },
      trace: trace as never
    });

    expect(result.success).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(result.stepRuns[0]?.assertionRuns[0]?.observedActions).toHaveLength(1);
  });

  it("passes extract assertions with Stagehand-native extraction results", async () => {
    const extract = vi.fn(async () => "Todo Bench");

    const result = await executeScenarioSteps({
      stagehand: { extract },
      page: createPage(),
      scenario: {
        scenarioId: "smoke-load",
        title: "Load the app",
        source: "synthetic",
        steps: [
          {
            stepId: "smoke-load.assert-heading",
            title: "Verify the heading",
            assertions: [
              {
                assertionId: "smoke-load.heading",
                type: "extract",
                instruction: "extract the main page heading text",
                resultType: "string",
                match: { equals: "Todo Bench" }
              }
            ]
          }
        ]
      },
      trace: []
    });

    expect(result.success).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.stepRuns[0]?.assertionRuns[0]?.extractedValue).toBe("Todo Bench");
  });

  it("executes a step action with observe plus act before validating assertions", async () => {
    const observe = vi.fn(async (instruction: string) => {
      if (instruction === "click the Add task button") {
        return [{ selector: "button[data-action='add']", description: "Add task button", method: "click" }];
      }

      return [{ selector: "button[data-action='remove']", description: "Remove task button", method: "click" }];
    });
    const act = vi.fn(async () => undefined);

    const result = await executeScenarioSteps({
      stagehand: { observe, act },
      page: createPage(),
      scenario: {
        scenarioId: "add-task",
        title: "Add a task",
        source: "generated",
        steps: [
          {
            stepId: "add-task.submit",
            title: "Submit the task",
            actionInstruction: "click the Add task button",
            assertions: [
              {
                assertionId: "add-task.remove-visible",
                type: "observe",
                instruction: "find the Remove button for the task Review benchmark notes",
                exists: true,
                method: "click"
              }
            ]
          }
        ]
      },
      trace: []
    });

    expect(result.success).toBe(true);
    expect(act).toHaveBeenCalledTimes(1);
    expect(result.stepRuns[0]?.executedAction?.selector).toBe("button[data-action='add']");
  });

  it("aborts the scenario on the first failing step", async () => {
    const extract = vi
      .fn()
      .mockResolvedValueOnce("Todo Bench")
      .mockResolvedValueOnce("0 of 2 tasks done");

    const result = await executeScenarioSteps({
      stagehand: { extract },
      page: createPage(),
      scenario: {
        scenarioId: "smoke-load",
        title: "Load the app",
        source: "synthetic",
        steps: [
          {
            stepId: "smoke-load.assert-heading",
            title: "Verify the heading",
            assertions: [
              {
                assertionId: "smoke-load.heading",
                type: "extract",
                instruction: "extract the main page heading text",
                resultType: "string",
                match: { equals: "Todo Bench" }
              }
            ]
          },
          {
            stepId: "smoke-load.assert-progress",
            title: "Verify the progress card",
            assertions: [
              {
                assertionId: "smoke-load.progress",
                type: "extract",
                instruction: "extract the text shown in the Progress summary card",
                resultType: "string",
                match: { equals: "1 of 2 tasks done" }
              }
            ]
          },
          {
            stepId: "smoke-load.unreachable",
            title: "This step should never run",
            assertions: [
              {
                assertionId: "smoke-load.unreachable-assertion",
                type: "extract",
                instruction: "extract anything",
                resultType: "string",
                match: { equals: "never" }
              }
            ]
          }
        ]
      },
      trace: []
    });

    expect(result.success).toBe(false);
    expect(result.stepRuns).toHaveLength(2);
    expect(result.stepRuns[1]?.success).toBe(false);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("does not invoke agent fallback when a scenario step fails", async () => {
    const observe = vi.fn(async () => []);
    const agent = vi.fn(() => ({ execute: vi.fn() }));

    const result = await executeScenarioSteps({
      stagehand: { observe, agent },
      page: createPage(),
      scenario: {
        scenarioId: "add-task",
        title: "Add a task",
        source: "generated",
        steps: [
          {
            stepId: "add-task.submit",
            title: "Submit the task",
            actionInstruction: "click the Add task button",
            assertions: [
              {
                assertionId: "add-task.remove-visible",
                type: "observe",
                instruction: "find the Remove button for the task Review benchmark notes",
                exists: true,
                method: "click"
              }
            ]
          }
        ]
      },
      trace: []
    });

    expect(result.success).toBe(false);
    expect(agent).not.toHaveBeenCalled();
  });
});
