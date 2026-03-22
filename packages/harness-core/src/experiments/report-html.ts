import { round } from "./common.js";

interface BarItem {
  label: string;
  value: number;
  max?: number;
  hint?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBars(items: BarItem[], valueFormatter: (value: number) => string): string {
  const maxValue = items.reduce((max, item) => Math.max(max, item.max ?? item.value, 1), 1);
  return items
    .map((item) => {
      const width = round((item.value / maxValue) * 100, 2);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span>${escapeHtml(item.label)}</span>
            <span>${escapeHtml(valueFormatter(item.value))}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${width}%"></div>
          </div>
          ${item.hint ? `<div class="bar-hint">${escapeHtml(item.hint)}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

function renderMetricTable(
  headers: string[],
  rows: Array<Array<string | number>>
): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderExperimentDashboard(input: {
  title: string;
  subtitle: string;
  scoreBars: BarItem[];
  secondaryCharts: Array<{
    title: string;
    items: BarItem[];
    formatter?: (value: number) => string;
  }>;
  leaderboardHeaders: string[];
  leaderboardRows: Array<Array<string | number>>;
}): string {
  const secondary = input.secondaryCharts
    .map(
      (chart) => `
      <section class="panel">
        <h2>${escapeHtml(chart.title)}</h2>
        ${renderBars(chart.items, chart.formatter ?? ((value) => value.toFixed(3)))}
      </section>
    `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        --bg: #f7f4ef;
        --panel: #fffdf8;
        --ink: #1c1a17;
        --muted: #6f685d;
        --line: #dfd6c8;
        --bar: #18625d;
        --bar-soft: #b9ddd3;
        --accent: #bf5a36;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(191, 90, 54, 0.12), transparent 28%),
          linear-gradient(180deg, #fbf8f2 0%, var(--bg) 100%);
      }
      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 24px auto 48px;
        display: grid;
        gap: 16px;
      }
      header, .panel {
        background: color-mix(in srgb, var(--panel) 92%, white 8%);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 20px 22px;
        box-shadow: 0 14px 40px rgba(28, 26, 23, 0.06);
      }
      header h1 {
        margin: 0 0 8px;
        font-size: clamp(1.8rem, 4vw, 3rem);
      }
      header p {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      h2 {
        margin: 0 0 14px;
        font-size: 1.1rem;
      }
      .bar-row + .bar-row { margin-top: 14px; }
      .bar-meta, .bar-hint {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .bar-meta {
        font-weight: 600;
        margin-bottom: 6px;
      }
      .bar-hint {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .bar-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        background: var(--bar-soft);
        overflow: hidden;
      }
      .bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--bar), var(--accent));
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid var(--line);
      }
      th { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
      td { font-size: 0.96rem; }
      @media (max-width: 640px) {
        header, .panel { padding: 16px; }
        th, td { padding: 9px 8px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(input.title)}</h1>
        <p>${escapeHtml(input.subtitle)}</p>
      </header>
      <section class="panel">
        <h2>Overall Score</h2>
        ${renderBars(input.scoreBars, (value) => `${value.toFixed(1)} / 100`)}
      </section>
      <div class="grid">
        ${secondary}
      </div>
      <section class="panel">
        <h2>Leaderboard</h2>
        ${renderMetricTable(input.leaderboardHeaders, input.leaderboardRows)}
      </section>
    </main>
  </body>
</html>`;
}
