import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkMetricColumn
} from "./types.js";
import type { UsageCostSummary } from "../types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function costBadge(summary: UsageCostSummary): string {
  if (summary.callCount === 0) {
    return "No AI calls";
  }
  if (summary.costSource === "estimated") {
    return "Estimated";
  }
  if (summary.costSource === "unavailable") {
    return summary.totalResolvedUsd > 0 ? "Partial" : "Unavailable";
  }
  return "";
}

function formatMetricValue(
  column: BenchmarkMetricColumn,
  value: number | string | null,
  costSummary?: UsageCostSummary
): string {
  if (value === null || value === undefined) {
    return "&mdash;";
  }

  if (column.kind === "text") {
    return escapeHtml(String(value));
  }

  if (typeof value !== "number") {
    return escapeHtml(String(value));
  }

  switch (column.kind) {
    case "score":
      return value.toFixed(3);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "ms":
      return `${value.toFixed(0)} ms`;
    case "integer":
      return String(Math.round(value));
    case "usd": {
      if (!costSummary) {
        return `$${value.toFixed(4)}`;
      }
      const badge = costBadge(costSummary);
      if (costSummary.callCount === 0 && value <= 0) {
        return escapeHtml(badge);
      }
      if (costSummary.costSource === "unavailable" && value <= 0) {
        return badge;
      }
      return `${`$${value.toFixed(4)}`}${badge ? ` <span class="cost-badge">${escapeHtml(badge)}</span>` : ""}`;
    }
  }
}

function renderMeta(report: BenchmarkComparisonReport): string {
  return `
    <dl class="report-meta">
      <div><dt>Generated</dt><dd>${escapeHtml(report.generatedAt)}</dd></div>
      <div><dt>Runs</dt><dd>${String(report.runIds.length)}</dd></div>
      <div><dt>Apps</dt><dd>${String(report.appIds.length)}</dd></div>
      <div><dt>Modes</dt><dd>${String(report.modeSections.length)}</dd></div>
    </dl>
  `;
}

function average(values: number[]): number | undefined {
  if (!values.length) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricValue(input: {
  section: BenchmarkComparisonSection;
  row: BenchmarkComparisonSection["rows"][number];
  key: string;
}): number | undefined {
  const values = input.row.cells
    .map((cell) => cell.metrics[input.key])
    .filter((value): value is number => typeof value === "number");

  if (!values.length) {
    return undefined;
  }

  const column = input.section.metricColumns.find((item) => item.key === input.key);
  if (column?.aggregate === "sum") {
    return values.reduce((sum, value) => sum + value, 0);
  }

  return average(values);
}

function formatCompactValue(kind: "ms" | "usd" | "score", value: number): string {
  if (kind === "ms") {
    return `${value.toFixed(0)} ms`;
  }
  if (kind === "score") {
    return value.toFixed(3);
  }
  return `$${value.toFixed(4)}`;
}

function collectSectionVisualData(section: BenchmarkComparisonSection): Array<{
  modelId: string;
  score?: number;
  avgLatency?: number;
  avgCost?: number;
  totalCost?: number;
}> {
  return section.rows
    .map((row) => ({
      modelId: row.modelId,
      score: metricValue({ section, row, key: "score" }),
      avgLatency: metricValue({ section, row, key: "avgLatency" }),
      avgCost: metricValue({ section, row, key: "avgCost" }),
      totalCost: metricValue({ section, row, key: "totalCost" })
    }))
    .filter(
      (row) =>
        typeof row.score === "number" ||
        typeof row.avgLatency === "number" ||
        typeof row.avgCost === "number" ||
        typeof row.totalCost === "number"
    );
}

function renderHorizontalBarChart(input: {
  title: string;
  subtitle: string;
  color: string;
  kind: "ms" | "usd";
  sort: "asc" | "desc";
  data: Array<{ label: string; value: number }>;
}): string {
  if (!input.data.length) {
    return "";
  }

  const sorted = [...input.data].sort((left, right) =>
    input.sort === "asc" ? left.value - right.value : right.value - left.value
  );
  const width = 620;
  const marginLeft = 250;
  const marginRight = 115;
  const chartWidth = width - marginLeft - marginRight;
  const rowHeight = 44;
  const top = 16;
  const bottom = 26;
  const height = top + sorted.length * rowHeight + bottom;
  const maxValue = Math.max(...sorted.map((item) => item.value), 0.0001);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const axisY = height - 8;

  const bars = sorted
    .map((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = (item.value / maxValue) * chartWidth;
      return `
        <g>
          <text x="${marginLeft - 12}" y="${y + 22}" class="plot-label" text-anchor="end">${escapeHtml(item.label)}</text>
          <rect x="${marginLeft}" y="${y + 8}" width="${chartWidth}" height="18" rx="7" fill="#f0e8dc" />
          <rect x="${marginLeft}" y="${y + 8}" width="${barWidth}" height="18" rx="7" fill="${input.color}" />
          <text x="${width - marginRight + 10}" y="${y + 22}" class="plot-value">${escapeHtml(
            formatCompactValue(input.kind, item.value)
          )}</text>
        </g>
      `;
    })
    .join("");

  const grid = ticks
    .map((tick) => {
      const x = marginLeft + chartWidth * tick;
      return `
        <line x1="${x}" y1="${top - 2}" x2="${x}" y2="${axisY - 14}" class="plot-grid" />
        <text x="${x}" y="${axisY + 12}" class="plot-tick" text-anchor="${
          tick === 0 ? "start" : tick === 1 ? "end" : "middle"
        }">${escapeHtml(formatCompactValue(input.kind, maxValue * tick))}</text>
      `;
    })
    .join("");

  return `
    <article class="chart-card">
      <header>
        <h3>${escapeHtml(input.title)}</h3>
        <p>${escapeHtml(input.subtitle)}</p>
      </header>
      <div class="chart-frame">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(input.title)}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="#fffdfa" />
          ${grid}
          ${bars}
        </svg>
      </div>
    </article>
  `;
}

function renderScatterChart(input: {
  title: string;
  subtitle: string;
  data: Array<{
    label: string;
    latencyMs: number;
    costUsd: number;
    score?: number;
  }>;
}): string {
  if (!input.data.length) {
    return "";
  }

  const width = 620;
  const height = 380;
  const marginLeft = 70;
  const marginRight = 24;
  const marginTop = 28;
  const marginBottom = 54;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  const maxLatency = Math.max(...input.data.map((item) => item.latencyMs), 1);
  const maxCost = Math.max(...input.data.map((item) => item.costUsd), 0.0001);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const grid = ticks
    .map((tick) => {
      const x = marginLeft + chartWidth * tick;
      const y = marginTop + chartHeight * (1 - tick);
      return `
        <line x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + chartHeight}" class="plot-grid" />
        <line x1="${marginLeft}" y1="${y}" x2="${marginLeft + chartWidth}" y2="${y}" class="plot-grid" />
        <text x="${x}" y="${height - 18}" class="plot-tick" text-anchor="${
          tick === 0 ? "start" : tick === 1 ? "end" : "middle"
        }">${escapeHtml(formatCompactValue("ms", maxLatency * tick))}</text>
        <text x="${marginLeft - 10}" y="${y + 4}" class="plot-tick" text-anchor="end">${escapeHtml(
          formatCompactValue("usd", maxCost * tick)
        )}</text>
      `;
    })
    .join("");

  const points = input.data
    .map((item) => {
      const x = marginLeft + (item.latencyMs / maxLatency) * chartWidth;
      const y = marginTop + (1 - item.costUsd / maxCost) * chartHeight;
      const radius = typeof item.score === "number" ? 7 + Math.max(0, Math.min(1, item.score)) * 6 : 9;
      return `
        <g>
          <circle cx="${x}" cy="${y}" r="${radius}" class="plot-point" />
          <text x="${x + radius + 6}" y="${y + 4}" class="plot-label">${escapeHtml(item.label)}</text>
        </g>
      `;
    })
    .join("");

  return `
    <article class="chart-card chart-card-wide">
      <header>
        <h3>${escapeHtml(input.title)}</h3>
        <p>${escapeHtml(input.subtitle)}</p>
      </header>
      <div class="chart-frame">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(input.title)}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="#fffdfa" />
          ${grid}
          <line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${marginLeft + chartWidth}" y2="${marginTop + chartHeight}" class="plot-axis" />
          <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + chartHeight}" class="plot-axis" />
          ${points}
          <text x="${marginLeft + chartWidth / 2}" y="${height - 4}" class="plot-axis-label" text-anchor="middle">Average Latency</text>
          <text x="20" y="${marginTop + chartHeight / 2}" class="plot-axis-label" text-anchor="middle" transform="rotate(-90 20 ${marginTop + chartHeight / 2})">Average Cost</text>
        </svg>
      </div>
    </article>
  `;
}

function renderSectionVisuals(section: BenchmarkComparisonSection): string {
  const data = collectSectionVisualData(section);
  if (!data.length) {
    return "";
  }

  const spendData = data
    .map((item) => ({
      label: item.modelId,
      value: item.totalCost ?? item.avgCost
    }))
    .filter((item): item is { label: string; value: number } => typeof item.value === "number");
  const latencyData = data
    .map((item) => ({
      label: item.modelId,
      value: item.avgLatency
    }))
    .filter((item): item is { label: string; value: number } => typeof item.value === "number");
  const scatterData = data
    .filter((item): item is { modelId: string; score?: number; avgLatency: number; avgCost: number; totalCost?: number } =>
      typeof item.avgLatency === "number" && typeof item.avgCost === "number"
    )
    .map((item) => ({
      label: item.modelId,
      latencyMs: item.avgLatency,
      costUsd: item.avgCost,
      score: item.score
    }));

  const charts = [
    renderHorizontalBarChart({
      title: "Spend by Model",
      subtitle: "Total spend across the displayed app cells for this mode section.",
      color: "#8b6c32",
      kind: "usd",
      sort: "desc",
      data: spendData
    }),
    renderHorizontalBarChart({
      title: "Average Latency by Model",
      subtitle: "Mean latency across the displayed app cells for this mode section.",
      color: "#42577a",
      kind: "ms",
      sort: "asc",
      data: latencyData
    }),
    renderScatterChart({
      title: "Price vs Speed Frontier",
      subtitle: "Each point is a model; larger points indicate higher benchmark score.",
      data: scatterData
    })
  ].filter(Boolean);

  if (!charts.length) {
    return "";
  }

  return `<div class="section-visuals">${charts.join("")}</div>`;
}

function renderMatrix(section: BenchmarkComparisonSection): string {
  const columnCount = section.metricColumns.length;

  return `
    <div class="table-wrap">
      <table class="matrix-table">
        <thead>
          <tr>
            <th rowspan="2" class="model-col">Model</th>
            ${section.appIds
              .map((appId) => `<th colspan="${columnCount}" class="group-col">${escapeHtml(appId)}</th>`)
              .join("")}
          </tr>
          <tr>
            ${section.appIds
              .map(() =>
                section.metricColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${section.rows
            .map((row) => {
              const cellMap = new Map(row.cells.map((cell) => [cell.appId, cell]));
              return `
                <tr>
                  <th class="model-name">${escapeHtml(row.modelId)}</th>
                  ${section.appIds
                    .map((appId) => {
                      const cell = cellMap.get(appId);
                      return section.metricColumns
                        .map((column) => {
                          const metricValue = cell?.metrics[column.key] ?? null;
                          return `<td>${formatMetricValue(column, metricValue, cell?.costSummary)}</td>`;
                        })
                        .join("");
                    })
                    .join("")}
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAudit(section: BenchmarkComparisonSection): string {
  return `
    <div class="table-wrap audit-wrap">
      <table class="audit-table">
        <caption>${escapeHtml(section.audit.title)}</caption>
        <thead>
          <tr>${section.audit.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${section.audit.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderNotes(section: BenchmarkComparisonSection): string {
  if (!section.notes.length) {
    return "";
  }

  return `
    <ul class="section-notes">
      ${section.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  `;
}

export function renderBenchmarkComparisonHtml(report: BenchmarkComparisonReport): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)}</title>
    <style>
      :root {
        --paper: #fcfaf6;
        --ink: #181410;
        --muted: #635949;
        --rule: #d0c7bb;
        --rule-strong: #776a58;
        --accent: #8b6c32;
        --accent-soft: #f2ead8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        background: linear-gradient(180deg, #f3eee5 0%, #efe7d9 100%);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(1440px, calc(100vw - 32px));
        margin: 24px auto 40px;
        padding: 28px 30px 36px;
        background: var(--paper);
        border: 1px solid var(--rule);
        box-shadow: 0 20px 60px rgba(24, 20, 16, 0.08);
      }
      header {
        padding-bottom: 18px;
        border-bottom: 2px solid var(--rule-strong);
      }
      h1 {
        margin: 0;
        font-size: clamp(2rem, 3vw, 2.8rem);
        line-height: 1.05;
      }
      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 1rem;
      }
      .report-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px 14px;
        margin: 18px 0 0;
      }
      .report-meta div {
        padding: 10px 12px;
        background: #fff;
        border: 1px solid var(--rule);
      }
      .report-meta dt {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .report-meta dd {
        margin: 0;
        font-size: 0.98rem;
      }
      section {
        margin-top: 26px;
        padding-top: 18px;
        border-top: 1px solid var(--rule);
      }
      h2 {
        margin: 0;
        font-size: 1.55rem;
      }
      .section-summary {
        margin: 8px 0 16px;
        color: var(--muted);
        max-width: 1000px;
      }
      .section-visuals {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        margin: 0 0 18px;
      }
      .chart-card {
        background: #fff;
        border: 1px solid var(--rule);
        padding: 14px 14px 12px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
      }
      .chart-card-wide {
        grid-column: 1 / -1;
      }
      .chart-card h3 {
        margin: 0;
        font-size: 1rem;
      }
      .chart-card p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .chart-frame {
        margin-top: 12px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdfa 0%, #fbf6ed 100%);
      }
      .chart-frame svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .plot-grid {
        stroke: #ddd3c5;
        stroke-width: 1;
      }
      .plot-axis {
        stroke: #776a58;
        stroke-width: 1.4;
      }
      .plot-axis-label,
      .plot-value,
      .plot-label,
      .plot-tick {
        fill: #181410;
        font-family: Georgia, "Times New Roman", serif;
      }
      .plot-axis-label {
        font-size: 13px;
        font-weight: 700;
      }
      .plot-label,
      .plot-value {
        font-size: 12px;
      }
      .plot-tick {
        font-size: 11px;
        fill: #635949;
      }
      .plot-point {
        fill: rgba(139, 108, 50, 0.78);
        stroke: #4f4020;
        stroke-width: 1.5;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      .matrix-table thead th {
        border-bottom: 1px solid var(--rule-strong);
        padding: 10px 12px;
        font-size: 0.95rem;
        text-align: center;
        white-space: nowrap;
      }
      .matrix-table tbody td,
      .matrix-table tbody th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule);
        font-size: 0.94rem;
        text-align: center;
        white-space: nowrap;
      }
      .matrix-table .model-col,
      .matrix-table .model-name {
        text-align: left;
        position: sticky;
        left: 0;
        background: var(--paper);
      }
      .matrix-table .group-col {
        font-size: 1rem;
      }
      .audit-wrap {
        margin-top: 14px;
      }
      .audit-table caption {
        margin-bottom: 10px;
        text-align: left;
        font-weight: 700;
      }
      .audit-table th,
      .audit-table td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--rule);
        font-size: 0.9rem;
        text-align: left;
      }
      .section-notes {
        margin: 14px 0 0;
        padding-left: 20px;
        color: var(--muted);
      }
      .cost-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 6px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      @media (max-width: 900px) {
        main {
          width: calc(100vw - 16px);
          margin: 8px auto 18px;
          padding: 18px 14px 24px;
        }
        .matrix-table thead th,
        .matrix-table tbody td,
        .matrix-table tbody th,
        .audit-table th,
        .audit-table td {
          padding: 8px 9px;
          font-size: 0.85rem;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(report.title)}</h1>
        <p class="subtitle">${escapeHtml(report.subtitle)}</p>
        ${renderMeta(report)}
      </header>
      ${report.modeSections
        .map(
          (section) => `
            <section>
              <h2>${escapeHtml(section.title)}</h2>
              <p class="section-summary">${escapeHtml(section.summary)}</p>
              ${renderSectionVisuals(section)}
              ${renderMatrix(section)}
              ${renderAudit(section)}
              ${renderNotes(section)}
            </section>
          `
        )
        .join("")}
    </main>
  </body>
</html>`;
}
