import { describe, expect, it } from "vitest";
import { evaluateExpectation } from "../../src/runner/expectations.js";

function createMockPage(bodyText: string, url = "http://127.0.0.1:3101", title = "Todo React Bench") {
  return {
    url: () => url,
    title: async () => title,
    evaluate: async () => bodyText
  };
}

describe("evaluateExpectation", () => {
  it("passes when text_not_visible is absent", async () => {
    const result = await evaluateExpectation(
      createMockPage("Todo React Bench\nPlan React todo benchmark"),
      {
        type: "text_not_visible",
        value: "Remove benchmark draft"
      }
    );

    expect(result.success).toBe(true);
  });

  it("fails when text_not_visible is still present", async () => {
    const result = await evaluateExpectation(
      createMockPage("Todo React Bench\nRemove benchmark draft"),
      {
        type: "text_not_visible",
        value: "Remove benchmark draft"
      }
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("still contains");
  });
});
