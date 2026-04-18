import { describe, expect, it } from "vitest";
import { buildBenchmarkSummaryFigures } from "../../src/experiments/report-overview.js";
import type { BenchmarkComparisonSection, BenchmarkMetricColumn } from "../../src/experiments/types.js";

const METRIC_COLUMNS: BenchmarkMetricColumn[] = [
  { key: "score", label: "Score", kind: "score", aggregate: "mean" },
  { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
  { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
  { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
];

function buildSection(input: {
  kind: "qa" | "explore" | "heal";
  title: string;
  appIds: string[];
  rows: Array<{
    modelId: string;
    provider: string;
    cells: Array<{
      appId: string;
      score: number;
      avgLatency: number;
      avgCost: number;
      totalCost: number;
    }>;
  }>;
}): BenchmarkComparisonSection {
  return {
    kind: input.kind,
    title: input.title,
    summary: `${input.title} summary`,
    appIds: input.appIds,
    metricColumns: METRIC_COLUMNS,
    rows: input.rows.map((row) => ({
      modelId: row.modelId,
      provider: row.provider,
      avgScore: row.cells.reduce((sum, cell) => sum + cell.score, 0) / row.cells.length,
      cells: row.cells.map((cell, index) => ({
        appId: cell.appId,
        runIds: [`${input.kind}-${row.modelId}-${index}`],
        metrics: {
          score: cell.score,
          avgLatency: cell.avgLatency,
          avgCost: cell.avgCost,
          totalCost: cell.totalCost
        },
        costSummary: {
          avgResolvedUsd: cell.avgCost,
          totalResolvedUsd: cell.totalCost,
          costSource: "exact",
          callCount: 1,
          unavailableCalls: 0
        }
      }))
    })),
    notes: [],
    audit: {
      title: `${input.title} Audit`,
      columns: ["Model"],
      rows: input.rows.map((row) => [row.modelId])
    }
  };
}

describe("benchmark summary figures", () => {
  it("builds deterministic score columns, missing cells, and shared frontier metadata", () => {
    const figures = buildBenchmarkSummaryFigures([
      buildSection({
        kind: "qa",
        title: "Guided",
        appIds: ["todo-b", "todo-a"],
        rows: [
          {
            modelId: "model/a",
            provider: "alpha",
            cells: [
              { appId: "todo-a", score: 80, avgLatency: 1200, avgCost: 0.5, totalCost: 1.2 },
              { appId: "todo-b", score: 90, avgLatency: 1000, avgCost: 0.3, totalCost: 0.9 }
            ]
          },
          {
            modelId: "model/b",
            provider: "beta",
            cells: [{ appId: "todo-a", score: 80, avgLatency: 1500, avgCost: 0.2, totalCost: 0.6 }]
          }
        ]
      }),
      buildSection({
        kind: "explore",
        title: "Explore",
        appIds: ["todo-a"],
        rows: [
          {
            modelId: "model/a",
            provider: "alpha",
            cells: [{ appId: "todo-a", score: 55, avgLatency: 900, avgCost: 0.35, totalCost: 0.7 }]
          },
          {
            modelId: "model/c",
            provider: "gamma",
            cells: [{ appId: "todo-a", score: 75, avgLatency: 700, avgCost: 0.25, totalCost: 0.5 }]
          }
        ]
      })
    ]);

    expect(figures).toBeDefined();
    expect(figures!.scoreMatrix.columns.map((column) => column.key)).toEqual([
      "qa:todo-a",
      "qa:todo-b",
      "explore:todo-a"
    ]);
    expect(figures!.scoreMatrix.rows.map((row) => row.modelId)).toEqual(["model/b", "model/c", "model/a"]);

    const rowA = figures!.scoreMatrix.rows.find((row) => row.modelId === "model/a");
    const rowB = figures!.scoreMatrix.rows.find((row) => row.modelId === "model/b");
    const rowC = figures!.scoreMatrix.rows.find((row) => row.modelId === "model/c");

    expect(rowA?.cells.map((cell) => cell.score)).toEqual([80, 90, 55]);
    expect(rowB?.cells[0]?.score).toBe(80);
    expect(rowB?.cells[1]?.missing).toBe(true);
    expect(rowC?.cells[0]?.missing).toBe(true);
    expect(rowB?.meanScore).toBe(80);
    expect(rowA?.meanScore).toBe(75);
    expect(JSON.stringify(figures)).not.toContain("rank");

    expect(figures!.efficiencyFrontier.panels.map((panel) => panel.kind)).toEqual(["qa", "explore"]);
    expect(figures!.efficiencyFrontier.legend.map((entry) => entry.modelId)).toEqual(["model/b", "model/c", "model/a"]);
    expect(figures!.efficiencyFrontier.xDomain.max).toBeGreaterThan(0);
    expect(
      figures!.efficiencyFrontier.panels
        .flatMap((panel) => panel.points)
        .some((point) => point.modelId === "model/c" && point.paretoOptimal)
    ).toBe(true);
  });

  it("returns no overview figures for single-mode reports", () => {
    const figures = buildBenchmarkSummaryFigures([
      buildSection({
        kind: "qa",
        title: "Guided",
        appIds: ["todo-react"],
        rows: [
          {
            modelId: "model/a",
            provider: "alpha",
            cells: [{ appId: "todo-react", score: 90, avgLatency: 800, avgCost: 0.1, totalCost: 0.4 }]
          }
        ]
      })
    ]);

    expect(figures).toBeUndefined();
  });
});
