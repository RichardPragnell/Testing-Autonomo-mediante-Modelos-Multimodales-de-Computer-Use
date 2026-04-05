import { describe, expect, it } from "vitest";
import { buildBenchmarkSummaryFigures } from "../../src/experiments/report-overview.js";
import { renderBenchmarkComparisonHtml } from "../../src/experiments/report-matrix.js";
import type { BenchmarkComparisonReport } from "../../src/experiments/types.js";

describe("matrix report renderer", () => {
  it("renders scorecards, a compact leaderboard, and lean per-mode tables", () => {
    const modeSections: BenchmarkComparisonReport["modeSections"] = [
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
          columns: ["App", "Model", "Runs", "Avg Cost", "Total Cost", "Source", "Calls", "Unavailable Calls"],
          rows: [["todo-vue", "google/gemini-2.5-flash", "1", "$0.0022", "$0.0154", "Partial exact coverage", "7", "2"]]
        }
      },
      {
        kind: "explore",
        title: "Explore",
        summary: "Explore summary.",
        appIds: ["todo-react"],
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
            avgScore: 82.1,
            cells: [
              {
                appId: "todo-react",
                runIds: ["explore-demo"],
                metrics: { score: 82.1, avgLatency: 920, avgCost: 0.0034, totalCost: 0.0102 },
                costSummary: {
                  avgResolvedUsd: 0.0034,
                  totalResolvedUsd: 0.0102,
                  costSource: "exact",
                  callCount: 3,
                  unavailableCalls: 0
                }
              }
            ]
          }
        ],
        notes: [],
        audit: {
          title: "Explore Cost Audit",
          columns: ["App", "Model", "Runs", "Avg Cost", "Total Cost", "Source", "Calls", "Unavailable Calls"],
          rows: [["todo-react", "google/gemini-2.5-flash", "1", "$0.0034", "$0.0102", "Exact", "3", "0"]]
        }
      }
    ];

    const report: BenchmarkComparisonReport = {
      title: "Benchmark Final Report",
      subtitle: "Matrix comparison across benchmark runs.",
      generatedAt: "2026-03-29T12:00:00.000Z",
      runIds: ["qa-demo", "explore-demo", "heal-demo"],
      appIds: ["todo-react", "todo-vue"],
      finalReportPath: "",
      finalJsonPath: "",
      provenance: {
        selectionPolicy: "latest-per-app-mode-model",
        note: "Rebuilt from the latest available report per mode, app, and model; report timestamps may differ across sections.",
        selectedReports: [
          {
            kind: "qa",
            appId: "todo-react",
            modelId: "google/gemini-2.5-flash",
            runId: "qa-demo",
            generatedAt: "2026-03-29T12:00:00.000Z",
            reportPath: "results/qa/reports/qa-demo.json"
          }
        ]
      },
      modeSections,
      summaryFigures: buildBenchmarkSummaryFigures(modeSections)
    };

    const html = renderBenchmarkComparisonHtml(report);
    expect(html).toContain("Benchmark Final Report");
    expect(html).toContain("Benchmark Scorecard");
    expect(html).toContain("Overall Leaderboard");
    expect(html).toContain("Efficiency Frontier by Mode");
    expect(html).toContain("Guided");
    expect(html).toContain("Explore");
    expect(html).toContain("Winner");
    expect(html).toContain("Coverage");
    expect(html).toContain("Mean Total Cost");
    expect(html).toContain("Average Latency by Model");
    expect(html).toContain("Price vs Speed Frontier");
    expect(html).toContain("Guided Cost Audit");
    expect(html).toContain("Explore Cost Audit");
    expect(html).toContain("Rebuild Provenance");
    expect(html).toContain("latest-per-app-mode-model");
    expect(html).toContain("Per-App Model Comparison");
    expect(html).toContain("todo-react Score by Model");
    expect(html).toContain("todo-vue Price vs Speed");
    expect(html).toContain("metric-bar-list");
    expect(html).toContain("plot-legend");
    expect(html).toContain("leaderboard-table");
    expect(html).toContain("frontier-panel-grid");
    expect(html).toContain("<th>Total Cost</th>");
    expect(html).toContain("app-group-even");
    expect(html).toContain("app-group-odd");
    expect(html).toContain("group-start");
    expect(html).not.toContain("<dt>Runs</dt>");
    expect(html).not.toContain("<th>Run</th>");
    expect(html).not.toContain("<th>Source</th>");
    expect(html).not.toContain("<th>Calls</th>");
    expect(html).not.toContain("<th>Unavailable Calls</th>");
    expect(html).not.toContain("Avg Cost");
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
    expect(html).not.toContain("Benchmark Scorecard");
    expect(html).not.toContain("Overall Leaderboard");
    expect(html).not.toContain("Per-App Model Comparison");
  });
});
