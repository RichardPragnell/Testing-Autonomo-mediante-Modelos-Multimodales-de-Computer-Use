import { join } from "node:path";
import type {
  BenchmarkComparisonCell,
  BenchmarkComparisonReport,
  BenchmarkComparisonRow,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn,
  CompareLeaderboardEntry
} from "./types.js";
import type { UsageCostSummary } from "../types.js";
import { ensureDir, resolveWorkspacePath, writeJson, writeText } from "../utils/fs.js";
import { renderBenchmarkComparisonHtml } from "./report-matrix.js";
import { average, formatCostSource, formatCostSummary, mergeCostSources } from "./report-utils.js";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sortMetricValue(value: number | string | null): number {
  return typeof value === "number" ? value : 0;
}

function aggregateMetricValues(
  column: BenchmarkMetricColumn,
  values: Array<number | string | null>
): number | string | null {
  const usable = values.filter((value) => value !== null && value !== undefined);
  if (!usable.length) {
    return null;
  }

  if (column.aggregate === "first") {
    return usable[0] ?? null;
  }

  const numericValues = usable.filter((value): value is number => typeof value === "number");
  if (!numericValues.length) {
    return null;
  }

  if (column.aggregate === "sum") {
    return numericValues.reduce((sum, value) => sum + value, 0);
  }

  return average(numericValues);
}

function aggregateCostSummary(cells: BenchmarkComparisonCell[]): UsageCostSummary {
  return {
    avgResolvedUsd: average(cells.map((cell) => cell.costSummary.avgResolvedUsd)),
    totalResolvedUsd: cells.reduce((sum, cell) => sum + cell.costSummary.totalResolvedUsd, 0),
    costSource: mergeCostSources(cells.map((cell) => cell.costSummary.costSource)),
    callCount: cells.reduce((sum, cell) => sum + cell.costSummary.callCount, 0),
    unavailableCalls: cells.reduce((sum, cell) => sum + cell.costSummary.unavailableCalls, 0)
  };
}

export function aggregateModeSection(
  sections: BenchmarkComparisonSection[],
  summary: string
): BenchmarkComparisonSection {
  if (!sections.length) {
    throw new Error("cannot aggregate empty comparison sections");
  }

  const base = sections[0];
  const appIds = unique(sections.flatMap((section) => section.appIds)).sort((left, right) => left.localeCompare(right));
  const models = unique(
    sections.flatMap((section) => section.rows.map((row) => `${row.provider}::${row.modelId}`))
  ).map((key) => {
    const [provider, modelId] = key.split("::");
    return { provider, modelId };
  });

  const rows: BenchmarkComparisonRow[] = models
    .map(({ provider, modelId }) => {
      const cells: BenchmarkComparisonCell[] = appIds.flatMap((appId) => {
        const matching = sections.flatMap((section) =>
          section.rows
            .filter((row) => row.modelId === modelId)
            .flatMap((row) => row.cells.filter((cell) => cell.appId === appId))
        );
        if (!matching.length) {
          return [];
        }

        const metrics = Object.fromEntries(
          base.metricColumns.map((column) => [
            column.key,
            aggregateMetricValues(
              column,
              matching.map((cell) => cell.metrics[column.key] ?? null)
            )
          ])
        );

        return [
          {
            appId,
            runIds: unique(matching.flatMap((cell) => cell.runIds)).sort((left, right) => left.localeCompare(right)),
            metrics,
            costSummary: aggregateCostSummary(matching)
          }
        ];
      });

      const scores = cells
        .map((cell) => cell.metrics.score)
        .filter((value): value is number => typeof value === "number");

      return {
        modelId,
        provider,
        avgScore: average(scores),
        cells
      };
    })
    .sort((left, right) => right.avgScore - left.avgScore);

  return {
    kind: base.kind,
    title: base.title,
    summary,
    appIds,
    metricColumns: base.metricColumns,
    rows,
    notes: unique(sections.flatMap((section) => section.notes)),
    audit: {
      title: `${base.title} Cost Audit`,
      columns: ["App", "Model", "Runs", "Avg Cost", "Total Cost", "Source", "Calls", "Unavailable Calls"],
      rows: rows.flatMap((row) =>
        row.cells.map((cell) => [
          cell.appId,
          row.modelId,
          String(cell.runIds.length),
          formatCostSummary(cell.costSummary, "avgResolvedUsd"),
          formatCostSummary(cell.costSummary, "totalResolvedUsd"),
          formatCostSource(cell.costSummary),
          String(cell.costSummary.callCount),
          String(cell.costSummary.unavailableCalls)
        ])
      )
    }
  };
}

export function buildAggregateLeaderboard(section: BenchmarkComparisonSection): CompareLeaderboardEntry[] {
  return section.rows.map((row) => ({
    modelId: row.modelId,
    avgScore: Number(row.avgScore.toFixed(3)),
    runs: unique(row.cells.flatMap((cell) => cell.runIds)).length
  }));
}

export async function persistComparisonReport(input: {
  title: string;
  subtitle: string;
  runIds: string[];
  modeSections: BenchmarkComparisonSection[];
  resultsDir: string;
  prefix: string;
}): Promise<BenchmarkComparisonReport> {
  const reportsRoot = join(await resolveWorkspacePath(input.resultsDir), "compare", "reports");
  await ensureDir(reportsRoot);
  const stamp = Date.now();
  const finalReportPath = join(reportsRoot, `${input.prefix}-${stamp}.html`);
  const finalJsonPath = join(reportsRoot, `${input.prefix}-${stamp}.json`);
  const report: BenchmarkComparisonReport = {
    title: input.title,
    subtitle: input.subtitle,
    generatedAt: new Date().toISOString(),
    runIds: [...input.runIds].sort((left, right) => left.localeCompare(right)),
    appIds: unique(input.modeSections.flatMap((section) => section.appIds)).sort((left, right) => left.localeCompare(right)),
    modeSections: input.modeSections,
    finalReportPath,
    finalJsonPath
  };

  await writeJson(finalJsonPath, report);
  await writeText(finalReportPath, renderBenchmarkComparisonHtml(report));
  return report;
}
