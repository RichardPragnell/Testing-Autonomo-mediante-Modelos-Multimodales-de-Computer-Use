import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { rebuildBenchmarkReports } from "../../src/service.js";

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
    { key: "avgLatency", label: "Avg Latency", kind: "ms", aggregate: "mean" },
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
  score: number
) {
  const title = kind === "qa" ? "Guided" : kind === "explore" ? "Explore" : "Self-Heal";
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
                avgLatency: 800,
                avgCost: 0.004,
                totalCost: 0.012
              },
              costSummary: {
                avgResolvedUsd: 0.004,
                totalResolvedUsd: 0.012,
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
      resultsDir: dir
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
        rankMatrix?: { columns: unknown[] };
        efficiencyFrontier?: { panels: unknown[] };
      };
    };
    expect(html).toContain("Benchmark Final Report");
    expect(html).toContain("At a Glance");
    expect(html).toContain("Models Across Modes");
    expect(html).toContain("Apps Across Modes");
    expect(html).toContain("Benchmark Matrix");
    expect(html).toContain("Overall Leaderboard");
    expect(html).toContain("Efficiency Frontier by Mode");
    expect(html).toContain("Guided");
    expect(html).toContain("Self-Heal");
    expect(html).toContain("latest-per-app-mode-model");
    expect(html).not.toContain("Guided Cost Audit");
    expect(html).not.toContain("Rebuild Provenance");
    expect(html).not.toContain("Explore Mode Comparison");
    expect(standardizedHtml).toContain("Standardized Results by Mode");
    expect(standardizedHtml).toContain("Compare Model Performance per App");
    expect(standardizedHtml).toContain("Reading Guide");
    expect(standardizedHtml).not.toContain("At a Glance");
    expect(standardizedJson.title).toBe("Benchmark Standardized Tables Report");
    expect(standardizedJson.subtitle).toContain("Standardized benchmark tables by mode");
    expect(standardizedJson.modeSections?.[0]?.scoreDefinition?.formula).toBe("Guided formula.");
    expect(json.summaryFigures?.rankMatrix?.columns.length).toBeGreaterThan(0);
    expect(json.summaryFigures?.efficiencyFrontier?.panels.length).toBe(2);
  });
});
