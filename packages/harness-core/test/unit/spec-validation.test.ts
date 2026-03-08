import { describe, expect, it } from "vitest";
import { validateBenchmarkSuite } from "../../src/config/suite.js";

describe("validateBenchmarkSuite", () => {
  it("fills defaults and validates required fields", () => {
    const suite = validateBenchmarkSuite({
      suiteId: "pulse-lab-guided",
      targetId: "pulse-lab",
      scenarioIds: ["smoke"],
      bugIds: [],
      explorationMode: "guided"
    });

    expect(suite.suiteId).toBe("pulse-lab-guided");
    expect(suite.trials).toBe(3);
    expect(suite.timeoutMs).toBe(60000);
    expect(suite.viewport.width).toBe(1280);
    expect(suite.viewport.height).toBe(720);
    expect(suite.resultsDir).toBe("results");
  });
});
