import { describe, expect, it } from "vitest";
import { renderBenchmarkComparisonHtml } from "../../src/experiments/report-matrix.js";
import type { BenchmarkComparisonReport } from "../../src/experiments/types.js";

describe("matrix report renderer", () => {
  it("renders grouped app headers, mode sections, and cost badges", () => {
    const report: BenchmarkComparisonReport = {
      title: "Benchmark Final Report",
      subtitle: "Matrix comparison across benchmark runs.",
      generatedAt: "2026-03-29T12:00:00.000Z",
      runIds: ["qa-demo", "explore-demo", "heal-demo"],
      appIds: ["todo-react", "todo-vue"],
      finalReportPath: "",
      finalJsonPath: "",
      modeSections: [
        {
          kind: "qa",
          title: "Guided",
          summary: "Guided summary.",
          appIds: ["todo-react", "todo-vue"],
          metricColumns: [
            { key: "score", label: "Score", kind: "score", aggregate: "mean" },
            { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" }
          ],
          rows: [
            {
              modelId: "google/gemini-2.5-flash",
              provider: "google",
              avgScore: 88.9,
              cells: [
                {
                  appId: "todo-react",
                  runIds: ["qa-demo"],
                  metrics: { score: 88.9, avgCost: 0.0041 },
                  costSummary: {
                    avgResolvedUsd: 0.0041,
                    totalResolvedUsd: 0.0287,
                    costSource: "exact",
                    callCount: 7,
                    unavailableCalls: 0
                  }
                },
                {
                  appId: "todo-vue",
                  runIds: ["qa-demo-2"],
                  metrics: { score: 83.2, avgCost: 0.0022 },
                  costSummary: {
                    avgResolvedUsd: 0.0022,
                    totalResolvedUsd: 0.0154,
                    costSource: "unavailable",
                    callCount: 7,
                    unavailableCalls: 2
                  }
                }
              ]
            }
          ],
          notes: ["Unavailable labels indicate calls where the provider response lacked exact usage cost."],
          audit: {
            title: "Guided Cost Audit",
            columns: ["App", "Model", "Source"],
            rows: [["todo-vue", "google/gemini-2.5-flash", "Partial exact coverage"]]
          }
        }
      ]
    };

    const html = renderBenchmarkComparisonHtml(report);
    expect(html).toContain("Benchmark Final Report");
    expect(html).toContain("Guided");
    expect(html).toContain("todo-react");
    expect(html).toContain("todo-vue");
    expect(html).toContain("google/gemini-2.5-flash");
    expect(html).toContain("Avg Cost");
    expect(html).toContain("Partial");
    expect(html).toContain("Guided Cost Audit");
  });
});
