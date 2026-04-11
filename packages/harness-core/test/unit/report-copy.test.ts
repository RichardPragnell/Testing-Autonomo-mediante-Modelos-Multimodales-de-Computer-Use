import { describe, expect, it } from "vitest";
import { spanishMetricLabel, spanishScoreDefinition } from "../../src/experiments/report-copy.js";

describe("report copy", () => {
  it("localizes guided scenario metrics with scenario-first terminology", () => {
    const definition = spanishScoreDefinition("qa");

    expect(definition.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scenarioCompletionRate",
          label: "Finalización del escenario"
        }),
        expect.objectContaining({
          key: "stepPassRate",
          label: "Éxito por paso"
        })
      ])
    );
    expect(definition.formula).not.toContain("latencia");
    expect(definition.formula).not.toContain("coste");
  });

  it("localizes heal metrics with failing scenario wording", () => {
    const definition = spanishScoreDefinition("heal");

    expect(definition.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "failingScenarioFixRate",
          label: "Corrección de escenarios fallidos"
        })
      ])
    );
    expect(spanishMetricLabel("failingScenarioFix", "fallback")).toBe("Corrección de escenarios fallidos");
    expect(definition.formula).not.toContain("latencia");
    expect(definition.formula).not.toContain("coste");
  });
});
