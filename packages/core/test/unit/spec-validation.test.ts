import { describe, expect, it } from "vitest";
import { validateExperimentSpec } from "../../src/config/experiment.js";

describe("validateExperimentSpec", () => {
  it("fills defaults and validates required fields", () => {
    const spec = validateExperimentSpec({
      experimentId: "exp-smoke",
      aut: { url: "http://localhost:4000" }
    });

    expect(spec.experimentId).toBe("exp-smoke");
    expect(spec.trials).toBe(5);
    expect(spec.timeoutMs).toBe(60000);
    expect(spec.viewport.width).toBe(1280);
    expect(spec.viewport.height).toBe(720);
    expect(spec.tasks).toEqual([]);
  });
});

