import { describe, expect, it } from "vitest";
import { buildBenchmarkSummaryFigures } from "../../src/experiments/report-overview.js";
import {
  renderBenchmarkComparisonHtml,
  renderBenchmarkFinalComparisonHtml,
  renderBenchmarkStandardizedComparisonHtml
} from "../../src/experiments/report-matrix.js";
import type { BenchmarkComparisonReport } from "../../src/experiments/types.js";

function buildScoreDefinition(title: string) {
  return {
    modeDescription: `${title} mode description.`,
    formula: `${title} score formula.`,
    metrics: [
      {
        key: "score",
        label: "Score",
        weight: 0.5,
        description: `${title} score description.`,
        contribution: `${title} score contribution.`
      }
    ],
    specialRules: [`${title} special rule.`]
  };
}

function buildMultiModeReport(): BenchmarkComparisonReport {
  const modeSections: BenchmarkComparisonReport["modeSections"] = [
    {
      kind: "qa",
      title: "Guided",
      summary: "Resumen del modo guiado.",
      appIds: ["todo-react", "todo-vue"],
      metricColumns: [
        { key: "score", label: "Score", kind: "score", aggregate: "mean" },
        { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
        { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
        { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
      ],
      scoreDefinition: buildScoreDefinition("Guided"),
      rows: [
        {
          modelId: "google/gemini-2.5-flash",
          provider: "google",
          avgScore: 88.9,
          cells: [
            {
              appId: "todo-react",
              runIds: ["guided-demo"],
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
              runIds: ["guided-demo-2"],
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
        },
        {
          modelId: "openai/gpt-4o-mini",
          provider: "openai",
          avgScore: 75.1,
          cells: [
            {
              appId: "todo-react",
              runIds: ["guided-demo-3"],
              metrics: { score: 75.1, avgLatency: 860, avgCost: 0.0037, totalCost: 0.0222 },
              costSummary: {
                avgResolvedUsd: 0.0037,
                totalResolvedUsd: 0.0222,
                costSource: "exact",
                callCount: 6,
                unavailableCalls: 0
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
      summary: "Resumen del modo de exploración.",
      appIds: ["todo-react"],
      metricColumns: [
        { key: "score", label: "Score", kind: "score", aggregate: "mean" },
        { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
        { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
        { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
      ],
      scoreDefinition: buildScoreDefinition("Explore"),
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
        },
        {
          modelId: "openai/gpt-4o-mini",
          provider: "openai",
          avgScore: 79.4,
          cells: [
            {
              appId: "todo-react",
              runIds: ["explore-demo-2"],
              metrics: { score: 79.4, avgLatency: 1010, avgCost: 0.0028, totalCost: 0.0084 },
              costSummary: {
                avgResolvedUsd: 0.0028,
                totalResolvedUsd: 0.0084,
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

  return {
    title: "Benchmark Final Report",
    subtitle: "Matrix comparison across benchmark runs.",
    generatedAt: "2026-03-29T12:00:00.000Z",
    runIds: ["guided-demo", "explore-demo", "heal-demo"],
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
          runId: "guided-demo",
          generatedAt: "2026-03-29T12:00:00.000Z",
          reportPath: "results/guided/reports/guided-demo.json"
        }
      ]
    },
    modeSections,
    summaryFigures: buildBenchmarkSummaryFigures(modeSections)
  };
}

function buildSingleModeReport(): BenchmarkComparisonReport {
  return {
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
      summary: "Resumen de exploración para un único modelo.",
        appIds: ["todo-react"],
        metricColumns: [
          { key: "score", label: "Score", kind: "score", aggregate: "mean" },
          { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
          { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
          { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
        ],
        scoreDefinition: buildScoreDefinition("Explore"),
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
}

function buildTieMultiModeReport(): BenchmarkComparisonReport {
  const report = buildMultiModeReport();
  report.modeSections = report.modeSections.map((section) => {
    if (section.kind !== "explore") {
      return section;
    }

    return {
      ...section,
      rows: section.rows.map((row) => ({
        ...row,
        avgScore: 82.1,
        cells: row.cells.map((cell) => ({
          ...cell,
          metrics: {
            ...cell.metrics,
            score: 82.1
          }
        }))
      }))
    };
  });
  report.summaryFigures = buildBenchmarkSummaryFigures(report.modeSections);
  return report;
}

describe("matrix report renderer", () => {
  it("renders the redesigned final benchmark report with mixed cross-mode sections", () => {
    const html = renderBenchmarkFinalComparisonHtml(buildMultiModeReport());

    expect(html).toContain("Informe final del benchmark");
    expect(html).toContain("Marco interpretativo");
    expect(html).toContain("Guía de lectura");
    expect(html).toContain("Visión de conjunto");
    expect(html).toContain("Modelos a través de los modos");
    expect(html).toContain("Aplicaciones a través de los modos");
    expect(html).toContain("Matriz global del benchmark");
    expect(html).toContain("Clasificación global");
    expect(html).toContain("Frontera de eficiencia por modo");
    expect(html).toContain("latest-per-app-mode-model");
    expect(html).toContain("todo-react");
    expect(html).toContain("todo-vue");
    expect(html).toContain("Mejor resultado");
    expect(html).toContain("Rango medio");
    expect(html).toContain('<strong class="best-score">1.00</strong>');
    expect(html).toContain('<strong class="best-score">$0.0222</strong>');
    expect(html).toContain("mode-cell-missing");
    expect(html).not.toContain("At a Glance");
    expect(html).not.toContain("Benchmark Scorecard");
    expect(html).not.toContain("Per-App Model Comparison");
    expect(html).not.toContain("Guided Cost Audit");
    expect(html).not.toContain("Explore Cost Audit");
    expect(html).not.toContain("Rebuild Provenance");
    expect(html).not.toContain("Selected Latest Reports");
  });

  it("keeps mode comparison pages on the existing layout", () => {
    const html = renderBenchmarkComparisonHtml(buildSingleModeReport());

    expect(html).toContain("Informe del modo de exploración para todo-react");
    expect(html).toContain("Cómo interpretar este informe");
    expect(html).toContain("Fundamento de la puntuación");
    expect(html).toContain("Puntuación = 100 x clamp(0.35 x Descubrimiento de capacidades");
    expect(html).toContain("Auditoría de coste del modo de exploración");
    expect(html).toContain("Frontera coste-latencia");
    expect(html).toContain('<strong class="best-score">91.795</strong>');
    expect(html).toContain('<strong class="best-score">3574 ms</strong>');
    expect(html).toContain('<strong class="best-score">$0.0070</strong>');
    expect(html).toContain("plot-chip");
    expect(html).toContain('text-anchor="end"');
    expect(html).not.toContain("At a Glance");
    expect(html).not.toContain("Models Across Modes");
    expect(html).not.toContain("Apps Across Modes");
    expect(html).not.toContain("Benchmark Matrix");
  });

  it("renders the standardized benchmark tables report with mode-first tables and per-app comparisons", () => {
    const html = renderBenchmarkStandardizedComparisonHtml(buildMultiModeReport());

    expect(html).toContain("Tablas normalizadas del benchmark");
    expect(html).toContain("Resultados normalizados por modo");
    expect(html).toContain("Comparación del rendimiento por aplicación");
    expect(html).toContain("Guía de lectura");
    expect(html).toContain("obtiene el mejor resultado en el modo guiado");
    expect(html).toContain("obtiene el mejor resultado en el modo de exploración");
    expect(html).toContain("todo-react");
    expect(html).toContain("todo-vue");
    expect(html).toContain("latest-per-app-mode-model");
    expect(html).toContain('<strong class="best-score">1.00</strong>');
    expect(html).toContain('<strong class="best-score">88.900</strong>');
    expect(html).toContain('<strong class="best-score">82.100</strong>');
    expect(html).toContain('<strong class="best-score">$0.0222</strong>');
    expect(html).not.toContain("At a Glance");
    expect(html).not.toContain("Benchmark Matrix");
    expect(html).not.toContain("Efficiency Frontier by Mode");
    expect(html).not.toContain("Guided Cost Audit");
  });

  it("bolds all tied best scores in the standardized report", () => {
    const html = renderBenchmarkStandardizedComparisonHtml(buildTieMultiModeReport());
    const tiedBolds = html.match(/<strong class="best-score">82\.100<\/strong>/g) ?? [];

    expect(tiedBolds.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the mode renderer when a final benchmark report only has one mode", () => {
    const html = renderBenchmarkFinalComparisonHtml(buildSingleModeReport());

    expect(html).toContain("Informe del modo de exploración para todo-react");
    expect(html).toContain("Frontera coste-latencia");
    expect(html).not.toContain("At a Glance");
    expect(html).not.toContain("Models Across Modes");
    expect(html).not.toContain("Apps Across Modes");
    expect(html).not.toContain("Benchmark Matrix");
  });
});
