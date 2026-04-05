import { average } from "./report-utils.js";
import type {
  BenchmarkComparisonCell,
  BenchmarkComparisonSection,
  BenchmarkEfficiencyFrontierFigure,
  BenchmarkEfficiencyFrontierPanel,
  BenchmarkEfficiencyFrontierPoint,
  BenchmarkRankMatrixCell,
  BenchmarkRankMatrixColumn,
  BenchmarkRankMatrixFigure,
  BenchmarkRankMatrixRow,
  BenchmarkSummaryFigures,
  ExperimentKind
} from "./types.js";

const MODE_ORDER: ExperimentKind[] = ["qa", "explore", "heal"];
const MODEL_PALETTE = [
  "#8b6c32",
  "#42577a",
  "#7f4b3e",
  "#5f8065",
  "#9f5f2b",
  "#6d5b95",
  "#467a72",
  "#a24d5c",
  "#556b2f",
  "#7d6b54",
  "#3b6a8d",
  "#825a75"
];

interface RankableCellMetric {
  modelId: string;
  provider: string;
  runIds: string[];
  score: number | null;
  avgLatency: number | null;
  avgCost: number | null;
  totalCost: number | null;
}

function metricNumber(cell: BenchmarkComparisonCell, key: string): number | null {
  const value = cell.metrics[key];
  return typeof value === "number" ? value : null;
}

function roundNumber(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function averageOrNull(values: number[], digits: number): number | null {
  if (!values.length) {
    return null;
  }
  return roundNumber(average(values), digits);
}

function compareNullableAsc(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
}

function compareRankableCells(left: RankableCellMetric, right: RankableCellMetric): number {
  return (
    compareNullableDesc(left.score, right.score) ||
    compareNullableAsc(left.totalCost, right.totalCost) ||
    compareNullableAsc(left.avgLatency, right.avgLatency) ||
    left.modelId.localeCompare(right.modelId)
  );
}

function paddedDomainMax(value: number, fallback: number): number {
  const safe = Math.max(value, fallback);
  return safe <= fallback ? fallback : roundNumber(safe * 1.12, 6);
}

function modeSectionsInOrder(modeSections: BenchmarkComparisonSection[]): BenchmarkComparisonSection[] {
  const sectionsByKind = new Map(modeSections.map((section) => [section.kind, section]));
  return MODE_ORDER.flatMap((kind) => {
    const section = sectionsByKind.get(kind);
    return section ? [section] : [];
  });
}

function buildRankMatrixColumns(modeSections: BenchmarkComparisonSection[]): BenchmarkRankMatrixColumn[] {
  return modeSections.flatMap((section) =>
    [...section.appIds].sort((left, right) => left.localeCompare(right)).map((appId) => ({
      key: `${section.kind}:${appId}`,
      kind: section.kind,
      modeTitle: section.title,
      appId,
      label: appId
    }))
  );
}

function buildModelColors(rows: BenchmarkRankMatrixRow[]): Map<string, string> {
  return new Map(
    rows.map((row, index) => {
      const paletteColor = MODEL_PALETTE[index % MODEL_PALETTE.length];
      if (index < MODEL_PALETTE.length) {
        return [row.modelId, paletteColor];
      }

      const hue = (index * 47) % 360;
      const saturation = 38 + ((index * 13) % 18);
      const lightness = 42 + ((index * 7) % 10);
      return [row.modelId, `hsl(${hue} ${saturation}% ${lightness}%)`];
    })
  );
}

function buildRankMatrix(modeSections: BenchmarkComparisonSection[]): BenchmarkRankMatrixFigure {
  const orderedSections = modeSectionsInOrder(modeSections);
  const columns = buildRankMatrixColumns(orderedSections);
  const modelRecords = new Map<
    string,
    {
      provider: string;
      cellsByColumn: Map<string, BenchmarkRankMatrixCell>;
    }
  >();

  for (const section of orderedSections) {
    for (const row of section.rows) {
      const existing = modelRecords.get(row.modelId);
      if (existing) {
        existing.provider = existing.provider || row.provider;
      } else {
        modelRecords.set(row.modelId, {
          provider: row.provider,
          cellsByColumn: new Map()
        });
      }
    }

    for (const appId of [...section.appIds].sort((left, right) => left.localeCompare(right))) {
      const columnKey = `${section.kind}:${appId}`;
      const rankedCells = section.rows
        .flatMap<RankableCellMetric>((row) => {
          const cell = row.cells.find((item) => item.appId === appId);
          if (!cell) {
            return [];
          }

          return [
            {
              modelId: row.modelId,
              provider: row.provider,
              runIds: cell.runIds,
              score: metricNumber(cell, "score"),
              avgLatency: metricNumber(cell, "avgLatency"),
              avgCost: metricNumber(cell, "avgCost"),
              totalCost: metricNumber(cell, "totalCost")
            }
          ];
        })
        .sort(compareRankableCells);

      rankedCells.forEach((entry, index) => {
        const rank = index + 1;
        const percentile =
          rankedCells.length <= 1 ? 1 : roundNumber((rankedCells.length - rank) / (rankedCells.length - 1), 6);
        const record = modelRecords.get(entry.modelId);
        if (!record) {
          return;
        }

        record.cellsByColumn.set(columnKey, {
          columnKey,
          kind: section.kind,
          appId,
          runIds: entry.runIds,
          missing: false,
          rank,
          rankPercentile: percentile,
          score: entry.score,
          avgLatency: entry.avgLatency === null ? null : roundNumber(entry.avgLatency, 3),
          avgCost: entry.avgCost === null ? null : roundNumber(entry.avgCost, 6),
          totalCost: entry.totalCost === null ? null : roundNumber(entry.totalCost, 6)
        });
      });
    }
  }

  const rows: BenchmarkRankMatrixRow[] = [...modelRecords.entries()]
    .map(([modelId, record]) => {
      const cells = columns.map<BenchmarkRankMatrixCell>((column) => {
        const existing = record.cellsByColumn.get(column.key);
        return (
          existing ?? {
            columnKey: column.key,
            kind: column.kind,
            appId: column.appId,
            runIds: [],
            missing: true,
            rank: null,
            rankPercentile: null,
            score: null,
            avgLatency: null,
            avgCost: null,
            totalCost: null
          }
        );
      });

      const populatedCells = cells.filter((cell) => !cell.missing);
      return {
        modelId,
        provider: record.provider,
        meanRank: averageOrNull(
          populatedCells.flatMap((cell) => (cell.rank === null ? [] : [cell.rank])),
          3
        ),
        meanScore: averageOrNull(
          populatedCells.flatMap((cell) => (cell.score === null ? [] : [cell.score])),
          3
        ),
        meanTotalCost: averageOrNull(
          populatedCells.flatMap((cell) => (cell.totalCost === null ? [] : [cell.totalCost])),
          6
        ),
        meanAvgCost: averageOrNull(
          populatedCells.flatMap((cell) => (cell.avgCost === null ? [] : [cell.avgCost])),
          6
        ),
        meanAvgLatency: averageOrNull(
          populatedCells.flatMap((cell) => (cell.avgLatency === null ? [] : [cell.avgLatency])),
          3
        ),
        cells
      };
    })
    .sort((left, right) => {
      return (
        compareNullableAsc(left.meanRank, right.meanRank) ||
        compareNullableDesc(left.meanScore, right.meanScore) ||
        compareNullableAsc(left.meanTotalCost, right.meanTotalCost) ||
        compareNullableAsc(left.meanAvgLatency, right.meanAvgLatency) ||
        left.modelId.localeCompare(right.modelId)
      );
    });

  return {
    title: "Overall Rank Matrix",
    caption:
      "Cells are ranked within each mode/app column using score descending, then total cost ascending, latency ascending, and model id. Darker cells indicate better rank. Hatched N/A cells indicate missing runs and are excluded from row means.",
    modeOrder: MODE_ORDER,
    columns,
    rows
  };
}

function isParetoOptimal(point: BenchmarkEfficiencyFrontierPoint, points: BenchmarkEfficiencyFrontierPoint[]): boolean {
  return !points.some(
    (candidate) =>
      candidate.modelId !== point.modelId &&
      candidate.avgLatency <= point.avgLatency &&
      candidate.avgCost <= point.avgCost &&
      (candidate.avgLatency < point.avgLatency || candidate.avgCost < point.avgCost)
  );
}

function buildEfficiencyFrontier(
  modeSections: BenchmarkComparisonSection[],
  rankRows: BenchmarkRankMatrixRow[]
): BenchmarkEfficiencyFrontierFigure {
  const orderedSections = modeSectionsInOrder(modeSections);
  const modelColors = buildModelColors(rankRows);

  const panels: BenchmarkEfficiencyFrontierPanel[] = orderedSections.map((section) => {
    const points = rankRows
      .flatMap<BenchmarkEfficiencyFrontierPoint>((rankRow) => {
        const row = section.rows.find((item) => item.modelId === rankRow.modelId);
        if (!row) {
          return [];
        }

        const avgLatency = average(
          row.cells.flatMap((cell) => {
            const value = metricNumber(cell, "avgLatency");
            return value === null ? [] : [value];
          })
        );
        const avgCost = average(
          row.cells.flatMap((cell) => {
            const value = metricNumber(cell, "avgCost");
            return value === null ? [] : [value];
          })
        );
        const avgScore = average(
          row.cells.flatMap((cell) => {
            const value = metricNumber(cell, "score");
            return value === null ? [] : [value];
          })
        );

        if (avgLatency === undefined || avgCost === undefined || avgScore === undefined) {
          return [];
        }

        return [
          {
            modelId: row.modelId,
            provider: row.provider,
            color: modelColors.get(row.modelId) ?? MODEL_PALETTE[0],
            avgLatency: roundNumber(avgLatency, 3),
            avgCost: roundNumber(avgCost, 6),
            avgScore: roundNumber(avgScore, 3),
            paretoOptimal: false
          }
        ];
      })
      .sort((left, right) => {
        return (
          compareNullableDesc(left.avgScore, right.avgScore) ||
          compareNullableAsc(left.avgCost, right.avgCost) ||
          compareNullableAsc(left.avgLatency, right.avgLatency) ||
          left.modelId.localeCompare(right.modelId)
        );
      });

    const enriched = points.map((point) => ({
      ...point,
      paretoOptimal: isParetoOptimal(point, points)
    }));

    return {
      kind: section.kind,
      title: section.title,
      points: enriched
    };
  });

  const allPoints = panels.flatMap((panel) => panel.points);
  const maxLatency = paddedDomainMax(Math.max(...allPoints.map((point) => point.avgLatency), 1), 1);
  const maxCost = paddedDomainMax(Math.max(...allPoints.map((point) => point.avgCost), 0.0001), 0.0001);

  return {
    title: "Efficiency Frontier by Mode",
    caption:
      "Each panel aggregates models across apps within a mode. Shared axes show mean latency and mean cost, bubble size shows mean raw score within that mode, and the frontier line traces Pareto-optimal models.",
    modeOrder: MODE_ORDER,
    xDomain: { min: 0, max: maxLatency },
    yDomain: { min: 0, max: maxCost },
    legend: rankRows
      .filter((row) => modelColors.has(row.modelId))
      .map((row) => ({
        modelId: row.modelId,
        provider: row.provider,
        color: modelColors.get(row.modelId) ?? MODEL_PALETTE[0]
      })),
    panels
  };
}

export function buildBenchmarkSummaryFigures(
  modeSections: BenchmarkComparisonSection[]
): BenchmarkSummaryFigures | undefined {
  if (modeSections.length < 2) {
    return undefined;
  }

  const rankMatrix = buildRankMatrix(modeSections);
  return {
    rankMatrix,
    efficiencyFrontier: buildEfficiencyFrontier(modeSections, rankMatrix.rows)
  };
}
