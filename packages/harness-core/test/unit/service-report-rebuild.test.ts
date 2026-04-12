import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { pruneNonReportableBenchmarkArtifacts, rebuildBenchmarkReports } from "../../src/service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function metricColumns() {
  return [
    { key: "score", label: "Score", kind: "score", aggregate: "mean" },
    { key: "avgLatency", label: "Run Latency", kind: "ms", aggregate: "mean" },
    { key: "avgCost", label: "Avg Cost", kind: "usd", aggregate: "mean" },
    { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" }
  ];
}

function scoreDefinition(title: string) {
  return {
    modeDescription: `${title} mode description.`,
    formula: `${title} formula.`,
    metrics: [
      {
        key: "score",
        label: "Score",
        weight: 1,
        description: `${title} description.`,
        contribution: `${title} contribution.`
      }
    ],
    specialRules: [`${title} special rule.`]
  };
}

function createReport(
  kind: "qa" | "explore" | "heal",
  appId: string,
  modelId: string,
  runId: string,
  generatedAt: string,
  score: number,
  options: {
    callCount?: number;
    avgLatency?: number;
    avgCost?: number;
    totalCost?: number;
    metrics?: Record<string, number>;
  } = {}
) {
  const title = kind === "qa" ? "Guided" : kind === "explore" ? "Explore" : "Self-Heal";
  const callCount = options.callCount ?? 3;
  const avgLatency = options.avgLatency ?? 800;
  const avgCost = options.avgCost ?? 0.004;
  const totalCost = options.totalCost ?? 0.012;
  return {
    kind,
    runId,
    appId,
    generatedAt,
    section: {
      kind,
      title,
      summary: `${title} summary`,
      appIds: [appId],
      metricColumns: metricColumns(),
      scoreDefinition: scoreDefinition(title),
      rows: [
        {
          modelId,
          provider: "google",
          avgScore: score,
          cells: [
            {
              appId,
              runIds: [runId],
              metrics: {
                score,
                ...(options.metrics ?? {}),
                avgLatency,
                avgCost,
                totalCost
              },
              costSummary: {
                avgResolvedUsd: avgCost,
                totalResolvedUsd: totalCost,
                costSource: "exact",
                callCount,
                unavailableCalls: 0
              }
            }
          ]
        }
      ],
      notes: [],
      audit: {
        title: `${title} Cost Audit`,
        columns: ["App", "Model", "Source"],
        rows: [[appId, modelId, "Exact"]]
      }
    }
  };
}

async function writeReport(
  root: string,
  kind: "qa" | "explore" | "heal",
  appId: string,
  modelId: string,
  runId: string,
  generatedAt: string,
  score: number
): Promise<void> {
  const reportsDir = join(root, kind === "qa" ? "guided" : kind, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, `${runId}.json`),
    `${JSON.stringify(createReport(kind, appId, modelId, runId, generatedAt, score), null, 2)}\n`,
    "utf8"
  );
}

async function writeInfrastructureFailedReport(
  root: string,
  kind: "qa" | "explore" | "heal",
  appId: string,
  modelId: string,
  runId: string,
  generatedAt: string
): Promise<void> {
  const reportsDir = join(root, kind === "qa" ? "guided" : kind, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, `${runId}.json`),
    `${JSON.stringify(
      createReport(kind, appId, modelId, runId, generatedAt, 0, {
        callCount: 0,
        avgLatency: 60_000,
        avgCost: 0,
        totalCost: 0
      }),
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeFailedHealRepairReport(
  root: string,
  appId: string,
  modelId: string,
  runId: string,
  generatedAt: string
): Promise<void> {
  const reportsDir = join(root, "heal", "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, `${runId}.json`),
    `${JSON.stringify(
      createReport("heal", appId, modelId, runId, generatedAt, 16.667, {
        callCount: 3,
        avgLatency: 60_000,
        avgCost: 0.007,
        totalCost: 0.021,
        metrics: {
          fixRate: 0,
          failingScenarioFix: 0,
          regressionFree: 0,
          validationPass: 0.666667,
          localization: 1,
          patchApply: 0.666667
        }
      }),
      null,
      2
    )}\n`,
    "utf8"
  );
}

describe("report rebuild", () => {
  it("picks the latest saved report per app and model within a mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-guided-"));
    tempDirs.push(dir);

    await writeReport(dir, "qa", "todo-react", "google/gemini-2.5-flash", "guided-todo-react-1", "2026-03-31T10:00:00.000Z", 0.41);
    await writeReport(dir, "qa", "todo-react", "google/gemini-2.5-flash", "guided-todo-react-2", "2026-03-31T11:00:00.000Z", 0.77);
    await writeReport(dir, "qa", "todo-react", "openai/gpt-4o-mini", "guided-todo-react-3", "2026-03-31T10:30:00.000Z", 0.55);
    await writeReport(dir, "qa", "todo-angular", "google/gemini-2.5-flash", "guided-todo-angular-1", "2026-03-31T09:30:00.000Z", 0.66);

    const rebuilt = await rebuildBenchmarkReports({
      mode: "qa",
      resultsDir: dir,
      htmlScope: "all"
    });

    expect(rebuilt.selectionPolicy).toBe("latest-per-app-mode-model");
    expect(rebuilt.selectedReports.map((item) => `${item.appId}:${item.modelId}:${item.runId}`)).toEqual([
      "todo-angular:google/gemini-2.5-flash:guided-todo-angular-1",
      "todo-react:google/gemini-2.5-flash:guided-todo-react-2",
      "todo-react:openai/gpt-4o-mini:guided-todo-react-3"
    ]);
    expect(rebuilt.modeReports).toHaveLength(1);
    expect(rebuilt.modeReports[0]?.kind).toBe("qa");
    expect(rebuilt.modeReports[0]?.finalReportPath).toContain("compare\\guided-compare-latest.html");
    expect(rebuilt.modeReports[0]?.finalJsonPath).toContain("compare\\guided-compare-latest.json");
    expect(rebuilt.finalReportPath).toBeUndefined();
    expect(rebuilt.finalJsonPath).toBeUndefined();

    const perRunHtmlPath = join(dir, "guided", "reports", "guided-todo-react-2.html");
    const perRunHtml = await readFile(perRunHtmlPath, "utf8");
    expect(perRunHtml).toContain("Informe del modo guiado para todo-react");
    expect(perRunHtml).toContain("Fundamento de la puntuación");

    const modeJson = JSON.parse(await readFile(rebuilt.modeReports[0]!.finalJsonPath, "utf8")) as {
      provenance?: {
        selectionPolicy?: string;
        selectedReports?: Array<{ modelId?: string }>;
      };
      modeSections?: Array<{
        scoreDefinition?: {
          formula?: string;
        };
      }>;
    };
    expect(modeJson.provenance?.selectionPolicy).toBe("latest-per-app-mode-model");
    expect(modeJson.provenance?.selectedReports?.map((item) => item.modelId)).toEqual([
      "google/gemini-2.5-flash",
      "google/gemini-2.5-flash",
      "openai/gpt-4o-mini"
    ]);
    expect(modeJson.modeSections?.[0]?.scoreDefinition?.formula).toBe("Guided formula.");
  });

  it("rebuilds available modes and the final mega report even when some modes are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-final-"));
    tempDirs.push(dir);

    await writeReport(dir, "qa", "todo-react", "google/gemini-2.5-flash", "guided-todo-react-3", "2026-03-31T12:00:00.000Z", 0.72);
    await writeReport(dir, "heal", "todo-angular", "google/gemini-2.5-flash", "heal-todo-angular-1", "2026-03-31T13:00:00.000Z", 0.58);

    const rebuilt = await rebuildBenchmarkReports({
      resultsDir: dir
    });

    expect(rebuilt.selectionPolicy).toBe("latest-per-app-mode-model");
    expect(rebuilt.selectedReports.map((item) => item.kind)).toEqual(["heal", "qa"]);
    expect(rebuilt.modeReports.map((item) => item.kind)).toEqual(["qa", "heal"]);
    expect(rebuilt.modeReports.every((item) => item.finalReportPath.includes("latest"))).toBe(true);
    expect(rebuilt.finalReportPath).toContain("compare\\benchmark-compare-latest.html");
    expect(rebuilt.finalJsonPath).toContain("compare\\benchmark-compare-latest.json");
    const standardizedReportPath = rebuilt.finalReportPath!.replace(
      "benchmark-compare-latest.html",
      "benchmark-compare-standardized-latest.html"
    );
    const standardizedJsonPath = rebuilt.finalJsonPath!.replace(
      "benchmark-compare-latest.json",
      "benchmark-compare-standardized-latest.json"
    );

    const html = await readFile(rebuilt.finalReportPath!, "utf8");
    const standardizedHtml = await readFile(standardizedReportPath, "utf8");
    const standardizedJson = JSON.parse(await readFile(standardizedJsonPath, "utf8")) as {
      title?: string;
      subtitle?: string;
      modeSections?: Array<{
        scoreDefinition?: {
          formula?: string;
        };
      }>;
    };
    const json = JSON.parse(await readFile(rebuilt.finalJsonPath!, "utf8")) as {
      summaryFigures?: {
        scoreMatrix?: { columns: unknown[] };
        rankMatrix?: unknown;
        efficiencyFrontier?: { panels: unknown[] };
      };
    };
    expect(html).toContain("Informe final del benchmark");
    expect(html).toContain("Marco interpretativo");
    expect(html).toContain("Guía de lectura");
    expect(html).toContain("Visión de conjunto");
    expect(html).toContain("Modelos a través de los modos");
    expect(html).toContain("Aplicaciones a través de los modos");
    expect(html).toContain("Matriz global del benchmark");
    expect(html).toContain("Resumen global");
    expect(html).toContain("Frontera de eficiencia por modo");
    expect(html).toContain("Modo guiado");
    expect(html).toContain("Modo de reparación");
    expect(html).toContain("latest-per-app-mode-model");
    expect(html).not.toContain("Rango");
    expect(html).not.toContain("rango");
    expect(html).not.toContain("rankMatrix");
    expect(html).not.toContain("meanRank");
    expect(html).not.toContain("rankPercentile");
    expect(html).not.toContain("At a Glance");
    expect(html).not.toContain("Guided Cost Audit");
    expect(html).not.toContain("Rebuild Provenance");
    expect(html).not.toContain("Explore Mode Comparison");
    expect(standardizedHtml).toContain("Tablas normalizadas del benchmark");
    expect(standardizedHtml).toContain("Resultados normalizados por modo");
    expect(standardizedHtml).toContain("Comparación del rendimiento por aplicación");
    expect(standardizedHtml).toContain("Guía de lectura");
    expect(standardizedHtml).not.toContain("At a Glance");
    expect(standardizedJson.title).toBe("Benchmark Standardized Tables Report");
    expect(standardizedJson.subtitle).toContain("Standardized benchmark tables by mode");
    expect(standardizedJson.modeSections?.[0]?.scoreDefinition?.formula).toBe("Guided formula.");
    expect(json.summaryFigures?.scoreMatrix?.columns.length).toBeGreaterThan(0);
    expect(json.summaryFigures?.rankMatrix).toBeUndefined();
    expect(json.summaryFigures?.efficiencyFrontier?.panels.length).toBe(2);
  });

  it("excludes infrastructure-failed rows from rebuilt reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-failed-"));
    tempDirs.push(dir);

    await writeReport(dir, "qa", "todo-react", "google/gemini-2.5-flash", "guided-todo-react-ok", "2026-03-31T12:00:00.000Z", 0.72);
    await writeInfrastructureFailedReport(
      dir,
      "qa",
      "todo-react",
      "example/infrastructure-failed-model",
      "guided-todo-react-failed",
      "2026-03-31T13:00:00.000Z"
    );

    const rebuilt = await rebuildBenchmarkReports({
      mode: "qa",
      resultsDir: dir
    });

    expect(rebuilt.selectedReports.map((item) => item.modelId)).toEqual(["google/gemini-2.5-flash"]);
    const modeJson = JSON.parse(await readFile(rebuilt.modeReports[0]!.finalJsonPath, "utf8")) as {
      modeSections?: Array<{
        rows?: Array<{ modelId?: string }>;
      }>;
    };
    expect(modeJson.modeSections?.[0]?.rows?.map((row) => row.modelId)).toEqual(["google/gemini-2.5-flash"]);
  });

  it("excludes failed heal repair rows from rebuilt reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-heal-failed-"));
    tempDirs.push(dir);

    await writeReport(dir, "heal", "todo-react", "google/gemini-2.5-flash", "heal-todo-react-ok", "2026-03-31T12:00:00.000Z", 0.72);
    await writeFailedHealRepairReport(
      dir,
      "todo-react",
      "example/failed-repair-model",
      "heal-todo-react-failed",
      "2026-03-31T13:00:00.000Z"
    );

    const rebuilt = await rebuildBenchmarkReports({
      mode: "heal",
      resultsDir: dir
    });

    expect(rebuilt.selectedReports.map((item) => item.modelId)).toEqual(["google/gemini-2.5-flash"]);
    const modeJson = JSON.parse(await readFile(rebuilt.modeReports[0]!.finalJsonPath, "utf8")) as {
      modeSections?: Array<{
        rows?: Array<{ modelId?: string }>;
      }>;
    };
    expect(modeJson.modeSections?.[0]?.rows?.map((row) => row.modelId)).toEqual(["google/gemini-2.5-flash"]);
  });

  it("keeps completed failed heal model data for skip-existing but prunes infrastructure failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-prune-heal-"));
    tempDirs.push(dir);

    const runId = "heal-todo-react-prune";
    const appId = "todo-react";
    const runsDir = join(dir, "heal", "runs");
    const runDir = join(runsDir, runId);
    const reportsDir = join(dir, "heal", "reports");
    const goodAttemptDir = join(runsDir, `${runId}-case-a-trial-1-model-1`);
    const failedAttemptDir = join(runsDir, `${runId}-case-a-trial-1-model-2`);
    const infraAttemptDir = join(runsDir, `${runId}-case-a-trial-1-model-3`);
    await mkdir(runDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });
    await mkdir(goodAttemptDir, { recursive: true });
    await mkdir(failedAttemptDir, { recursive: true });
    await mkdir(infraAttemptDir, { recursive: true });
    await writeFile(join(goodAttemptDir, "marker.txt"), "keep", "utf8");
    await writeFile(join(failedAttemptDir, "marker.txt"), "keep failed", "utf8");
    await writeFile(join(infraAttemptDir, "marker.txt"), "remove infra", "utf8");

    const goodModel = "google/gemini-2.5-flash";
    const failedModel = "mistralai/mistral-medium-3";
    const infraModel = "example/provider-timeout";
    await writeFile(
      join(runDir, "run.json"),
      `${JSON.stringify(
        {
          kind: "heal",
          runId,
          appId,
          startedAt: "2026-04-12T10:00:00.000Z",
          finishedAt: "2026-04-12T10:01:00.000Z",
          spec: {},
          modelSummaries: [
            {
              model: { id: goodModel, provider: "google", enabled: true, available: true },
              metrics: { modelId: goodModel, score: 100, fixRate: 1, failingScenarioFixRate: 1 },
              caseResults: [{ fixed: false, note: "fixed by aggregate metrics", reproductionRuns: [] }]
            },
            {
              model: { id: failedModel, provider: "mistral", enabled: true, available: true },
              metrics: { modelId: failedModel, score: 10 },
              caseResults: [
                {
                  fixed: false,
                  note: "not fixed",
                  reproductionRuns: [{ success: false, message: "scenario assertion failed", stepRuns: [] }],
                  findings: [],
                  repairUsage: { callCount: 1 },
                  patchGenerated: true,
                  patchApplied: false
                }
              ]
            },
            {
              model: { id: infraModel, provider: "example", enabled: true, available: true },
              metrics: { modelId: infraModel, score: 0 },
              caseResults: [
                {
                  fixed: false,
                  note: "repair model request failed: OpenRouter request timed out after 60000ms",
                  reproductionRuns: [],
                  findings: [],
                  repairUsage: { callCount: 0 },
                  patchGenerated: false,
                  patchApplied: false
                }
              ]
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const savedReport = createReport("heal", appId, goodModel, runId, "2026-04-12T10:01:00.000Z", 100, {
      metrics: { fixRate: 1, failingScenarioFix: 1 }
    });
    savedReport.section.rows.push({
      modelId: failedModel,
      provider: "mistral",
      avgScore: 10,
      cells: [
        {
          appId,
          runIds: [runId],
          metrics: { score: 10, fixRate: 0, failingScenarioFix: 0, avgLatency: 800, avgCost: 0.004, totalCost: 0.012 },
          costSummary: {
            avgResolvedUsd: 0.004,
            totalResolvedUsd: 0.012,
            costSource: "exact",
            callCount: 3,
            unavailableCalls: 0
          }
        }
      ]
    });
    savedReport.section.rows.push({
      modelId: infraModel,
      provider: "example",
      avgScore: 0,
      cells: [
        {
          appId,
          runIds: [runId],
          metrics: { score: 0, fixRate: 0, failingScenarioFix: 0, avgLatency: 60_000, avgCost: 0, totalCost: 0 },
          costSummary: {
            avgResolvedUsd: 0,
            totalResolvedUsd: 0,
            costSource: "exact",
            callCount: 0,
            unavailableCalls: 0
          }
        }
      ]
    });
    savedReport.section.audit.rows.push([appId, failedModel, "Exact"]);
    savedReport.section.audit.rows.push([appId, infraModel, "Exact"]);
    await writeFile(join(reportsDir, `${runId}.json`), `${JSON.stringify(savedReport, null, 2)}\n`, "utf8");

    const result = await pruneNonReportableBenchmarkArtifacts("heal", dir);

    expect(result.removedModelSummaries).toBe(1);
    const prunedArtifact = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as {
      modelSummaries: Array<{ metrics: { modelId: string } }>;
    };
    expect(prunedArtifact.modelSummaries.map((summary) => summary.metrics.modelId)).toEqual([goodModel, failedModel]);
    const prunedReport = JSON.parse(await readFile(join(reportsDir, `${runId}.json`), "utf8")) as {
      section: { rows: Array<{ modelId: string }>; audit: { rows: string[][] } };
    };
    expect(prunedReport.section.rows.map((row) => row.modelId)).toEqual([goodModel]);
    expect(prunedReport.section.audit.rows.flat()).not.toContain(failedModel);
    expect(prunedReport.section.audit.rows.flat()).not.toContain(infraModel);
    expect(await readFile(join(goodAttemptDir, "marker.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(failedAttemptDir, "marker.txt"), "utf8")).toBe("keep failed");
    await expect(readFile(join(infraAttemptDir, "marker.txt"), "utf8")).rejects.toThrow();
  });
});
