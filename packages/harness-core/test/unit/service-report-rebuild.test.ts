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

function createReport(kind: "qa" | "explore" | "heal", appId: string, runId: string, generatedAt: string, score: number) {
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
      rows: [
        {
          modelId: "google/gemini-2.5-flash",
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
        rows: [[appId, "google/gemini-2.5-flash", "Exact"]]
      }
    }
  };
}

async function writeReport(
  root: string,
  kind: "qa" | "explore" | "heal",
  appId: string,
  runId: string,
  generatedAt: string,
  score: number
): Promise<void> {
  const reportsDir = join(root, kind, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, `${runId}.json`),
    `${JSON.stringify(createReport(kind, appId, runId, generatedAt, score), null, 2)}\n`,
    "utf8"
  );
}

describe("report rebuild", () => {
  it("picks the latest saved report per app within a mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-qa-"));
    tempDirs.push(dir);

    await writeReport(dir, "qa", "todo-react", "qa-todo-react-1", "2026-03-31T10:00:00.000Z", 0.41);
    await writeReport(dir, "qa", "todo-react", "qa-todo-react-2", "2026-03-31T11:00:00.000Z", 0.77);
    await writeReport(dir, "qa", "todo-angular", "qa-todo-angular-1", "2026-03-31T09:30:00.000Z", 0.66);

    const rebuilt = await rebuildBenchmarkReports({
      mode: "qa",
      resultsDir: dir
    });

    expect(rebuilt.selectionPolicy).toBe("latest-per-app-mode");
    expect(rebuilt.selectedReports.map((item) => `${item.appId}:${item.runId}`)).toEqual([
      "todo-angular:qa-todo-angular-1",
      "todo-react:qa-todo-react-2"
    ]);
    expect(rebuilt.modeReports).toHaveLength(1);
    expect(rebuilt.modeReports[0]?.kind).toBe("qa");
    expect(rebuilt.finalReportPath).toBeUndefined();
    expect(rebuilt.finalJsonPath).toBeUndefined();

    const modeJson = JSON.parse(await readFile(rebuilt.modeReports[0]!.finalJsonPath, "utf8")) as {
      summaryFigures?: unknown;
    };
    expect(modeJson.summaryFigures).toBeUndefined();
  });

  it("rebuilds available modes and the final mega report even when some modes are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "report-rebuild-final-"));
    tempDirs.push(dir);

    await writeReport(dir, "qa", "todo-react", "qa-todo-react-3", "2026-03-31T12:00:00.000Z", 0.72);
    await writeReport(dir, "heal", "todo-angular", "heal-todo-angular-1", "2026-03-31T13:00:00.000Z", 0.58);

    const rebuilt = await rebuildBenchmarkReports({
      resultsDir: dir
    });

    expect(rebuilt.selectedReports.map((item) => item.kind)).toEqual(["heal", "qa"]);
    expect(rebuilt.modeReports.map((item) => item.kind)).toEqual(["qa", "heal"]);
    expect(rebuilt.finalReportPath).toBeTruthy();
    expect(rebuilt.finalJsonPath).toBeTruthy();

    const html = await readFile(rebuilt.finalReportPath!, "utf8");
    const json = JSON.parse(await readFile(rebuilt.finalJsonPath!, "utf8")) as {
      summaryFigures?: {
        rankMatrix?: { columns: unknown[] };
        efficiencyFrontier?: { panels: unknown[] };
      };
    };
    expect(html).toContain("Benchmark Final Report");
    expect(html).toContain("Cross-Benchmark Rank Matrix");
    expect(html).toContain("Efficiency Frontier by Mode");
    expect(html).toContain("Guided");
    expect(html).toContain("Self-Heal");
    expect(html).toContain("latest-per-app-mode");
    expect(html).not.toContain("Explore Mode Comparison");
    expect(json.summaryFigures?.rankMatrix?.columns.length).toBeGreaterThan(0);
    expect(json.summaryFigures?.efficiencyFrontier?.panels.length).toBe(2);
  });
});
