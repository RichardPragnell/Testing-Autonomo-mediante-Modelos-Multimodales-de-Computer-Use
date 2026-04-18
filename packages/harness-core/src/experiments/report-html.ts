export interface PaperKeyValue {
  label: string;
  value: string;
}

export interface PaperMetric {
  label: string;
  value: string;
}

export interface PaperSection {
  title: string;
  body: string[];
  facts?: PaperKeyValue[];
}

export interface PaperFigurePanel {
  label: string;
  title: string;
  subtitle?: string;
  imageDataUrl?: string;
  imageAlt?: string;
  metrics?: PaperMetric[];
  badges?: string[];
  caption?: string;
  note?: string;
}

export interface PaperFigure {
  title: string;
  caption: string;
  panels: PaperFigurePanel[];
}

export interface PaperChart {
  title: string;
  caption: string;
  svgMarkup: string;
  note?: string;
}

export interface PaperTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface PaperAppendixEntry {
  title: string;
  body?: string[];
  facts?: PaperKeyValue[];
  badges?: string[];
}

export interface PaperDocument {
  title: string;
  subtitle: string;
  abstract: string;
  meta: PaperKeyValue[];
  sections?: PaperSection[];
  figures?: PaperFigure[];
  figure?: PaperFigure;
  charts?: PaperChart[];
  tables?: PaperTable[];
  appendix?: PaperAppendixEntry[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMetaList(items: PaperKeyValue[], className = "meta-grid"): string {
  if (!items.length) {
    return "";
  }

  return `
    <dl class="${className}">
      ${items
        .map(
          (item) => `
          <div class="meta-item">
            <dt>${escapeHtml(item.label)}</dt>
            <dd>${escapeHtml(item.value)}</dd>
          </div>
        `
        )
        .join("")}
    </dl>
  `;
}

function renderSection(section: PaperSection, index: number): string {
  return `
    <section class="paper-section">
      <h2>${index + 1}. ${escapeHtml(section.title)}</h2>
      ${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      ${section.facts?.length ? renderMetaList(section.facts, "facts-grid") : ""}
    </section>
  `;
}

function renderMetrics(metrics: PaperMetric[]): string {
  if (!metrics.length) {
    return "";
  }

  return `
    <dl class="panel-metrics">
      ${metrics
        .map(
          (metric) => `
          <div class="panel-metric">
            <dt>${escapeHtml(metric.label)}</dt>
            <dd>${escapeHtml(metric.value)}</dd>
          </div>
        `
        )
        .join("")}
    </dl>
  `;
}

function renderBadges(badges: string[]): string {
  if (!badges.length) {
    return "";
  }

  return `<div class="badges">${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</div>`;
}

function renderFigure(figure: PaperFigure, sectionIndex: number, figureNumber: number): string {
  return `
    <section class="paper-section">
      <h2>${sectionIndex}. ${escapeHtml(figure.title)}</h2>
      <figure class="figure-plate">
        <div class="figure-panels">
          ${figure.panels
            .map(
              (panel) => `
              <article class="figure-panel">
                <header class="panel-header">
                  <span class="panel-label">${escapeHtml(panel.label)}</span>
                  <div>
                    <h3>${escapeHtml(panel.title)}</h3>
                    ${panel.subtitle ? `<p>${escapeHtml(panel.subtitle)}</p>` : ""}
                  </div>
                </header>
                ${
                  panel.imageDataUrl
                    ? `<div class="panel-image-wrap"><img class="panel-image" src="${panel.imageDataUrl}" alt="${escapeHtml(panel.imageAlt ?? panel.title)}" /></div>`
                    : `<div class="panel-image-wrap panel-image-empty">No screenshot available</div>`
                }
                ${renderMetrics(panel.metrics ?? [])}
                ${renderBadges(panel.badges ?? [])}
                ${panel.caption ? `<p class="panel-caption">${escapeHtml(panel.caption)}</p>` : ""}
                ${panel.note ? `<p class="panel-note">${escapeHtml(panel.note)}</p>` : ""}
              </article>
            `
            )
            .join("")}
        </div>
        <figcaption>Figure ${figureNumber}. ${escapeHtml(figure.caption)}</figcaption>
      </figure>
    </section>
  `;
}

function renderChart(chart: PaperChart, sectionIndex: number, figureNumber: number): string {
  return `
    <section class="paper-section">
      <h2>${sectionIndex}. ${escapeHtml(chart.title)}</h2>
      <figure class="figure-plate chart-plate">
        <div class="chart-wrap">${chart.svgMarkup}</div>
        ${chart.note ? `<p class="chart-note">${escapeHtml(chart.note)}</p>` : ""}
        <figcaption>Figure ${figureNumber}. ${escapeHtml(chart.caption)}</figcaption>
      </figure>
    </section>
  `;
}

function renderTable(table: PaperTable, index: number): string {
  return `
    <section class="paper-section">
      <h2>${index}. ${escapeHtml(table.title)}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${table.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAppendix(entries: PaperAppendixEntry[], sectionIndex: number): string {
  if (!entries.length) {
    return "";
  }

  return `
    <section class="paper-section appendix">
      <h2>${sectionIndex}. Appendix</h2>
      <div class="appendix-list">
        ${entries
          .map(
            (entry) => `
            <article class="appendix-entry">
              <h3>${escapeHtml(entry.title)}</h3>
              ${(entry.body ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
              ${entry.facts?.length ? renderMetaList(entry.facts, "facts-grid") : ""}
              ${renderBadges(entry.badges ?? [])}
            </article>
          `
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderPaperReport(input: PaperDocument): string {
  const sections = input.sections ?? [];
  const figures = [...(input.figures ?? []), ...(input.figure ? [input.figure] : [])];
  const charts = input.charts ?? [];
  const tables = input.tables ?? [];
  const appendix = input.appendix ?? [];
  let sectionCounter = 1;
  let figureCounter = 1;

  const sectionMarkup = sections
    .map((section) => {
      const markup = renderSection(section, sectionCounter - 1);
      sectionCounter += 1;
      return markup;
    })
    .join("");

  const figureMarkup = figures
    .map((figure) => {
      const markup = renderFigure(figure, sectionCounter, figureCounter);
      sectionCounter += 1;
      figureCounter += 1;
      return markup;
    })
    .join("");

  const chartMarkup = charts
    .map((chart) => {
      const markup = renderChart(chart, sectionCounter, figureCounter);
      sectionCounter += 1;
      figureCounter += 1;
      return markup;
    })
    .join("");

  const tableMarkup = tables
    .map((table) => {
      const markup = renderTable(table, sectionCounter);
      sectionCounter += 1;
      return markup;
    })
    .join("");

  const appendixMarkup = appendix.length ? renderAppendix(appendix, sectionCounter) : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        --paper: #f6f3ed;
        --sheet: #fffdf9;
        --ink: #161412;
        --muted: #655d53;
        --rule: #d8d1c7;
        --rule-strong: #aca392;
        --accent: #4d5b7c;
        --accent-soft: #eceff6;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        background: linear-gradient(180deg, #f2efe8 0%, var(--paper) 100%);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 32px auto 56px;
        background: var(--sheet);
        border-top: 1px solid var(--rule);
        border-bottom: 1px solid var(--rule);
        box-shadow: 0 18px 60px rgba(22, 20, 18, 0.08);
      }
      .paper-header,
      .paper-section {
        padding: 28px 34px;
      }
      .paper-header {
        border-bottom: 2px solid var(--rule-strong);
      }
      .paper-header h1 {
        margin: 0;
        font-size: clamp(2.1rem, 4vw, 3.4rem);
        line-height: 1.08;
      }
      .paper-header .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 1.05rem;
      }
      .abstract {
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr);
        border-bottom: 1px solid var(--rule);
      }
      .abstract-card {
        border: 1px solid var(--rule);
        background: #fcfaf5;
        padding: 18px 20px;
      }
      .abstract-card h2 {
        margin: 0 0 10px;
        font-size: 0.98rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .abstract-card p {
        margin: 0;
        font-size: 1rem;
        line-height: 1.7;
      }
      .paper-section + .paper-section {
        border-top: 1px solid var(--rule);
      }
      .paper-section h2 {
        margin: 0 0 12px;
        font-size: 1.3rem;
      }
      .paper-section h3 {
        margin: 0 0 8px;
        font-size: 1.05rem;
      }
      .paper-section p,
      .panel-caption,
      .panel-note {
        margin: 0 0 12px;
        line-height: 1.7;
      }
      .chart-wrap {
        border: 1px solid var(--rule);
        background: #fffdfa;
        padding: 12px;
      }
      .chart-wrap svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .chart-note {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.92rem;
      }
      .meta-grid,
      .facts-grid {
        display: grid;
        gap: 10px 18px;
        margin: 0;
      }
      .meta-grid {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
      .facts-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-top: 16px;
      }
      .meta-item {
        padding-top: 10px;
        border-top: 1px solid var(--rule);
      }
      .meta-item dt {
        margin: 0 0 4px;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .meta-item dd {
        margin: 0;
        font-weight: 600;
      }
      .figure-plate {
        margin: 0;
      }
      .figure-panels {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
      }
      .figure-panel,
      .appendix-entry {
        border: 1px solid var(--rule);
        background: #fffdfa;
        padding: 18px;
      }
      .panel-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;
      }
      .panel-header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.94rem;
      }
      .panel-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        height: 34px;
        border: 1px solid var(--rule-strong);
        font-size: 0.92rem;
        font-weight: 700;
      }
      .panel-image-wrap {
        aspect-ratio: 16 / 10;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: var(--accent-soft);
        border: 1px solid var(--rule);
        margin-bottom: 14px;
      }
      .panel-image-empty {
        color: var(--muted);
        font-size: 0.95rem;
      }
      .panel-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .panel-metrics {
        display: grid;
        gap: 10px 14px;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        margin: 0 0 14px;
      }
      .panel-metric {
        padding-top: 8px;
        border-top: 1px solid var(--rule);
      }
      .panel-metric dt {
        margin: 0 0 4px;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .panel-metric dd {
        margin: 0;
        font-weight: 600;
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 5px 9px;
        border: 1px solid var(--rule);
        background: #f7f3ec;
        font-size: 0.82rem;
      }
      .panel-note {
        margin-bottom: 0;
        color: var(--muted);
        font-size: 0.92rem;
      }
      figcaption {
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.94rem;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 11px 10px;
        text-align: left;
        border-bottom: 1px solid var(--rule);
        vertical-align: top;
      }
      th {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      td {
        font-size: 0.96rem;
      }
      .appendix-list {
        display: grid;
        gap: 14px;
      }
      .appendix-entry p:last-child {
        margin-bottom: 0;
      }
      @media (max-width: 860px) {
        .abstract {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 640px) {
        main {
          width: min(100vw, calc(100vw - 16px));
          margin: 8px auto 20px;
        }
        .paper-header,
        .paper-section {
          padding: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="paper-header">
        <h1>${escapeHtml(input.title)}</h1>
        <p class="subtitle">${escapeHtml(input.subtitle)}</p>
      </header>
      <section class="paper-section abstract">
        <div class="abstract-card">
          <h2>Abstract</h2>
          <p>${escapeHtml(input.abstract)}</p>
        </div>
        <div class="abstract-card">
          <h2>Run Metadata</h2>
          ${renderMetaList(input.meta)}
        </div>
      </section>
      ${sectionMarkup}
      ${figureMarkup}
      ${chartMarkup}
      ${tableMarkup}
      ${appendixMarkup}
    </main>
  </body>
</html>`;
}
