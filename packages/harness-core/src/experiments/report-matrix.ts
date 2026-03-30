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
