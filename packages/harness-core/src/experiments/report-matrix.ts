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

function shortenMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const visible = Math.max(8, maxLength - 1);
  const left = Math.ceil(visible / 2);
  const right = Math.floor(visible / 2);
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`;
}

function describeModelLabel(modelId: string): { primary: string; secondary?: string } {
  const slashIndex = modelId.indexOf("/");
  const base = slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
  const primary = shortenMiddle(base, 30);
  const secondary = primary === modelId ? undefined : modelId;
  return { primary, secondary };
}

function paddedDomainMax(value: number, fallback: number): number {
  const safe = Math.max(value, fallback);
  return safe <= fallback ? fallback : safe * 1.12;
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
  const maxValue = Math.max(...sorted.map((item) => item.value), 0.0001);
  const bars = sorted
    .map((item, index) => {
      const label = describeModelLabel(item.label);
      const width = Math.max(item.value > 0 ? 10 : 0, (item.value / maxValue) * 100);
      return `
        <li class="metric-bar-row">
          <div class="metric-bar-head">
            <div class="metric-bar-copy">
              <span class="metric-rank">${String(index + 1).padStart(2, "0")}</span>
              <div class="metric-labels">
                <span class="metric-label">${escapeHtml(label.primary)}</span>
                ${label.secondary ? `<span class="metric-detail">${escapeHtml(label.secondary)}</span>` : ""}
              </div>
            </div>
            <span class="metric-value">${escapeHtml(formatCompactValue(input.kind, item.value))}</span>
          </div>
          <div class="metric-track" aria-hidden="true">
            <span class="metric-fill" style="width: ${width.toFixed(1)}%; background: ${input.color};"></span>
          </div>
        </li>
      `;
    })
    .join("");

  return `
    <article class="chart-card">
      <header>
        <h3>${escapeHtml(input.title)}</h3>
        <p>${escapeHtml(input.subtitle)}</p>
      </header>
      <ol class="metric-bar-list" role="img" aria-label="${escapeHtml(input.title)}">${bars}</ol>
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

  const width = 860;
  const height = 430;
  const marginLeft = 88;
  const marginRight = 76;
  const marginTop = 28;
  const marginBottom = 64;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  const maxLatency = paddedDomainMax(Math.max(...input.data.map((item) => item.latencyMs), 1), 1);
  const maxCost = paddedDomainMax(Math.max(...input.data.map((item) => item.costUsd), 0.0001), 0.0001);
  const scoreValues = input.data
    .map((item) => item.score)
    .filter((value): value is number => typeof value === "number");
  const minScore = scoreValues.length ? Math.min(...scoreValues) : undefined;
  const maxScore = scoreValues.length ? Math.max(...scoreValues) : undefined;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const palette = [
    { fill: "#8b6c32", stroke: "#4f4020" },
    { fill: "#55708d", stroke: "#33455a" },
    { fill: "#7f4b3e", stroke: "#4d2b23" },
    { fill: "#5f8065", stroke: "#37503d" }
  ];

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
    .map((item, index) => {
      const x = marginLeft + (item.latencyMs / maxLatency) * chartWidth;
      const y = marginTop + (1 - item.costUsd / maxCost) * chartHeight;
      const radius =
        typeof item.score === "number" && typeof minScore === "number" && typeof maxScore === "number"
          ? minScore === maxScore
            ? 11
            : 8 + ((item.score - minScore) / (maxScore - minScore)) * 8
          : 10;
      const label = describeModelLabel(item.label);
      const color = palette[index % palette.length];
      const anchor = x > marginLeft + chartWidth * 0.78 ? "end" : "start";
      const labelX = anchor === "end" ? x - radius - 8 : x + radius + 8;
      const labelY =
        y < marginTop + 24 ? y + radius + 14 : y > marginTop + chartHeight - 18 ? y - radius - 8 : y + 4;
      return `
        <g>
          <line x1="${x}" y1="${y}" x2="${x}" y2="${marginTop + chartHeight}" class="plot-guide" />
          <line x1="${marginLeft}" y1="${y}" x2="${x}" y2="${y}" class="plot-guide" />
          <circle cx="${x}" cy="${y}" r="${radius}" class="plot-point" fill="${color.fill}" stroke="${color.stroke}" />
          <text x="${labelX}" y="${labelY}" class="plot-point-label" text-anchor="${anchor}">${escapeHtml(label.primary)}</text>
        </g>
      `;
    })
    .join("");

  const legend = input.data
    .map((item, index) => {
      const label = describeModelLabel(item.label);
      const color = palette[index % palette.length];
      return `
        <li class="plot-legend-item">
          <div class="plot-legend-copy">
            <span class="plot-legend-swatch" style="background: ${color.fill}; border-color: ${color.stroke};"></span>
            <div>
              <span class="plot-legend-label">${escapeHtml(label.primary)}</span>
              ${label.secondary ? `<span class="plot-legend-detail">${escapeHtml(label.secondary)}</span>` : ""}
            </div>
          </div>
          <div class="plot-legend-values">
            <span class="plot-chip">${escapeHtml(formatCompactValue("ms", item.latencyMs))}</span>
            <span class="plot-chip">${escapeHtml(formatCompactValue("usd", item.costUsd))}</span>
            ${typeof item.score === "number" ? `<span class="plot-chip">Score ${escapeHtml(formatCompactValue("score", item.score))}</span>` : ""}
          </div>
        </li>
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
          <text x="24" y="${marginTop + chartHeight / 2}" class="plot-axis-label" text-anchor="middle" transform="rotate(-90 24 ${marginTop + chartHeight / 2})">Average Cost</text>
        </svg>
      </div>
      <ul class="plot-legend" aria-label="${escapeHtml(input.title)} details">${legend}</ul>
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
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
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
      .metric-bar-list,
      .plot-legend {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
      }
      .metric-bar-list {
        display: grid;
        gap: 12px;
      }
      .metric-bar-row {
        padding: 14px 14px 12px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdfa 0%, #f8f1e4 100%);
      }
      .metric-bar-head,
      .plot-legend-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
      }
      .metric-bar-copy,
      .plot-legend-copy {
        display: flex;
        gap: 12px;
        min-width: 0;
      }
      .metric-rank {
        min-width: 2.2rem;
        padding-top: 1px;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .metric-labels {
        min-width: 0;
      }
      .metric-label,
      .plot-legend-label {
        display: block;
        font-size: 0.98rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .metric-detail,
      .plot-legend-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.35;
        word-break: break-word;
      }
      .metric-value {
        flex: 0 0 auto;
        padding-top: 1px;
        font-size: 1.02rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .metric-track {
        margin-top: 12px;
        height: 12px;
        border-radius: 999px;
        background: #eadfce;
        overflow: hidden;
      }
      .metric-fill {
        display: block;
        height: 100%;
        min-width: 0;
        border-radius: inherit;
        box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.12);
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
      .plot-guide {
        stroke: rgba(99, 89, 73, 0.28);
        stroke-dasharray: 5 5;
        stroke-width: 1;
      }
      .plot-axis {
        stroke: #776a58;
        stroke-width: 1.4;
      }
      .plot-axis-label,
      .plot-point-label,
      .plot-tick {
        fill: #181410;
        font-family: Georgia, "Times New Roman", serif;
      }
      .plot-axis-label {
        font-size: 13px;
        font-weight: 700;
      }
      .plot-point-label {
        font-size: 12px;
        font-weight: 700;
      }
      .plot-tick {
        font-size: 11px;
        fill: #635949;
      }
      .plot-point {
        stroke-width: 1.5;
        fill-opacity: 0.82;
      }
      .plot-legend {
        display: grid;
        gap: 10px;
      }
      .plot-legend-item {
        padding-top: 10px;
        border-top: 1px solid rgba(119, 106, 88, 0.18);
      }
      .plot-legend-item:first-child {
        padding-top: 0;
        border-top: 0;
      }
      .plot-legend-swatch {
        flex: 0 0 auto;
        width: 12px;
        height: 12px;
        margin-top: 4px;
        border: 2px solid transparent;
        border-radius: 999px;
      }
      .plot-legend-values {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .plot-chip {
        display: inline-flex;
        align-items: center;
        min-height: 1.9rem;
        padding: 0 10px;
        border-radius: 999px;
        background: #f2ead8;
        color: #4f4020;
        font-size: 0.78rem;
        font-weight: 700;
        white-space: nowrap;
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
        .section-visuals {
          grid-template-columns: 1fr;
        }
        .metric-bar-head,
        .plot-legend-item {
          flex-direction: column;
        }
        .metric-value,
        .plot-legend-values {
          justify-content: flex-start;
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
