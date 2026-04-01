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
            { key: "avgLatency", label: "Avg Latency", kind: "ms", aggregate: "mean" },
            { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
            { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
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
                  metrics: { score: 88.9, avgLatency: 740, avgCost: 0.0041, totalCost: 0.0287 },
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
                  metrics: { score: 83.2, avgLatency: 510, avgCost: 0.0022, totalCost: 0.0154 },
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
    expect(html).toContain("Average Latency by Model");
    expect(html).toContain("Price vs Speed Frontier");
    expect(html).toContain("Partial");
    expect(html).toContain("Guided Cost Audit");
    expect(html).toContain("metric-bar-list");
    expect(html).toContain("plot-legend");
  });

  it("keeps single-model visuals readable by rendering label details outside the plot", () => {
    const report: BenchmarkComparisonReport = {
      title: "Explore Report",
      subtitle: "Single model matrix comparison.",
      generatedAt: "2026-03-31T12:00:00.000Z",
      runIds: ["explore-demo"],
      appIds: ["todo-react"],
      finalReportPath: "",
      finalJsonPath: "",
      modeSections: [
        {
          kind: "explore",
          title: "Explore",
          summary: "Single-model explore summary.",
          appIds: ["todo-react"],
          metricColumns: [
            { key: "score", label: "Score", kind: "score", aggregate: "mean" },
            { key: "avgLatency", label: "Avg Latency", kind: "ms", aggregate: "mean" },
            { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
            { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
          ],
          rows: [
            {
              modelId: "google/gemini-2.5-flash-lite-preview-09-2025",
              provider: "google",
              avgScore: 91.795,
              cells: [
                {
                  appId: "todo-react",
                  runIds: ["explore-demo"],
                  metrics: { score: 91.795, avgLatency: 3574, avgCost: 0.007, totalCost: 0.007 },
                  costSummary: {
                    avgResolvedUsd: 0.007,
                    totalResolvedUsd: 0.007,
                    costSource: "exact",
                    callCount: 1,
                    unavailableCalls: 0
                  }
                }
              ]
            }
          ],
          notes: [],
          audit: {
            title: "Explore Cost Audit",
            columns: ["App", "Model", "Source"],
            rows: [["todo-react", "google/gemini-2.5-flash-lite-preview-09-2025", "Exact"]]
          }
        }
      ]
    };

    const html = renderBenchmarkComparisonHtml(report);

    expect(html).toContain("gemini-2.5-flash-lite-preview-09-2025");
    expect(html).toContain("google/gemini-2.5-flash-lite-preview-09-2025");
    expect(html).toContain("plot-chip");
    expect(html).toContain('text-anchor="end"');
  });
});
