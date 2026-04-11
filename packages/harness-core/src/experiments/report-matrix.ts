import type {
  BenchmarkComparisonReport,
  BenchmarkComparisonSection,
  BenchmarkEfficiencyFrontierFigure,
  BenchmarkEfficiencyFrontierPoint,
  BenchmarkMetricColumn,
  ExperimentKind
} from "./types.js";
import {
  localizedComparisonGuide,
  localizedCostBadge,
  localizedModeReadGuide,
  localizedSectionNotes,
  modeCopy,
  reportHeaderCopy,
  spanishMetricLabel,
  spanishScoreDefinition,
  type HtmlReportVariant
} from "./report-copy.js";
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
    return localizedCostBadge("no_ai_calls");
  }
  if (summary.costSource === "estimated") {
    return localizedCostBadge("estimated");
  }
  if (summary.costSource === "unavailable") {
    return summary.totalResolvedUsd > 0 ? localizedCostBadge("partial") : localizedCostBadge("unavailable");
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

const LEAN_MATRIX_COLUMN_KEYS = ["score", "avgLatency", "totalCost"] as const;
const LEAN_AUDIT_COLUMN_NAMES = ["App", "Model", "Total Cost"] as const;

function visibleMatrixColumns(section: BenchmarkComparisonSection): BenchmarkMetricColumn[] {
  return LEAN_MATRIX_COLUMN_KEYS.flatMap((key) => section.metricColumns.filter((column) => column.key === key));
}

function localizedMetricLabel(column: BenchmarkMetricColumn): string {
  return spanishMetricLabel(column.key, column.label);
}

function localizedModeTitle(kind: ExperimentKind): string {
  return modeCopy(kind).title;
}

function localizedModeShortTitle(kind: ExperimentKind): string {
  return modeCopy(kind).short;
}

function localizedModeContext(kind: ExperimentKind): string {
  return localizedModeTitle(kind).toLowerCase();
}

function reportHeader(report: BenchmarkComparisonReport, variant: HtmlReportVariant): { title: string; subtitle: string } {
  const section = report.modeSections[0];
  return reportHeaderCopy({
    variant,
    modeKind: section?.kind,
    appId: report.appIds.length === 1 ? report.appIds[0] : undefined,
    modelCount: section?.rows.length ?? 0,
    runCount: report.runIds.length,
    appCount: report.appIds.length,
    modeCount: report.modeSections.length
  });
}

function comparisonLabel(kind: ExperimentKind): string {
  if (kind === "qa") {
    return "finalización del escenario";
  }
  if (kind === "explore") {
    return "descubrimiento de capacidades";
  }
  return "tasa de corrección completa";
}

function comparisonValue(section: BenchmarkComparisonSection, row: BenchmarkComparisonSection["rows"][number]): number | undefined {
  if (section.kind === "qa") {
    return metricValue({ section, row, key: "scenarioCompletion" });
  }
  if (section.kind === "explore") {
    return metricValue({ section, row, key: "capabilityDiscovery" });
  }
  return metricValue({ section, row, key: "fixRate" }) ?? metricValue({ section, row, key: "failingScenarioFix" });
}

function sectionSummary(section: BenchmarkComparisonSection): string {
  const topModel = section.rows[0];
  if (!topModel) {
    return `No se dispone de resultados para el ${localizedModeContext(section.kind)}.`;
  }

  const evidence = comparisonValue(section, topModel);
  const totalCost = topModel.cells.reduce((sum, cell) => sum + cell.costSummary.totalResolvedUsd, 0);
  const evidenceText =
    typeof evidence === "number"
      ? `${comparisonLabel(section.kind)} del ${(evidence * 100).toFixed(1)}%`
      : `puntuación media de ${topModel.avgScore.toFixed(3)}`;
  return `${topModel.modelId} presenta el mejor desempeño en el ${localizedModeContext(section.kind)}, con una puntuación media de ${topModel.avgScore.toFixed(3)}, ${evidenceText} y un coste total agregado de ${formatCompactValue("usd", totalCost)}.`;
}

function sectionFinding(section: BenchmarkComparisonSection): string {
  const topModel = section.rows[0];
  if (!topModel) {
    return `La evidencia disponible para el ${localizedModeContext(section.kind)} es insuficiente para formular una conclusión comparativa.`;
  }

  const evidence = comparisonValue(section, topModel);
  const evidenceText =
    typeof evidence === "number"
      ? `${comparisonLabel(section.kind)} del ${(evidence * 100).toFixed(1)}%`
      : `puntuación media de ${topModel.avgScore.toFixed(3)}`;
  return `El patrón dominante sitúa a ${topModel.modelId} como referencia del modo, con ${evidenceText}.`;
}

function renderAcademicFrame(input: {
  title: string;
  summary: string;
  objective: string;
  method: string;
  conclusion: string;
}): string {
  return `
    <section>
      <h2>${escapeHtml(input.title)}</h2>
      <p class="section-summary">${escapeHtml(input.summary)}</p>
      <div class="read-guide-grid">
        <article class="read-guide-card">
          <h3>Objetivo</h3>
          <p>${escapeHtml(input.objective)}</p>
        </article>
        <article class="read-guide-card">
          <h3>Criterio de lectura</h3>
          <p>${escapeHtml(input.method)}</p>
        </article>
        <article class="read-guide-card">
          <h3>Conclusión sintética</h3>
          <p>${escapeHtml(input.conclusion)}</p>
        </article>
      </div>
    </section>
  `;
}

function renderMeta(report: BenchmarkComparisonReport): string {
  return `
    <dl class="report-meta">
      <div><dt>Generado</dt><dd>${escapeHtml(report.generatedAt)}</dd></div>
      <div><dt>Aplicaciones</dt><dd>${String(report.appIds.length)}</dd></div>
      <div><dt>Modos</dt><dd>${String(report.modeSections.length)}</dd></div>
    </dl>
  `;
}

function renderProvenance(report: BenchmarkComparisonReport): string {
  if (!report.provenance) {
    return "";
  }

  return `
    <section class="provenance-block">
      <h2>Proveniencia de la reconstrucción</h2>
      <p class="section-summary">
        Política de selección <span class="provenance-chip">${escapeHtml(report.provenance.selectionPolicy)}</span>.
        ${escapeHtml(
          report.modeSections.length > 1
            ? "La reconstrucción utiliza el informe más reciente disponible para cada combinación de modo, aplicación y modelo; por ello, las marcas temporales pueden diferir entre secciones."
            : "La reconstrucción utiliza el informe más reciente disponible para cada combinación de aplicación y modelo dentro del modo mostrado; por ello, las marcas temporales pueden diferir entre celdas."
        )}
      </p>
      <div class="table-wrap audit-wrap">
        <table class="audit-table">
          <caption>Informes seleccionados</caption>
      <thead>
        <tr>
          <th>Modo</th>
          <th>Aplicación</th>
          <th>Modelo</th>
          <th>Generado</th>
          <th>Informe</th>
        </tr>
      </thead>
      <tbody>
            ${report.provenance.selectedReports
              .map(
                (entry) => `
                  <tr>
                    <td>${escapeHtml(localizedModeShortTitle(entry.kind))}</td>
                    <td>${escapeHtml(entry.appId)}</td>
                    <td>${escapeHtml(entry.modelId)}</td>
                    <td>${escapeHtml(entry.generatedAt)}</td>
                    <td>${escapeHtml(entry.reportPath)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function formatOverviewValue(kind: "rank" | "score" | "ms" | "usd", value: number | null): string {
  if (value === null) {
    return "&mdash;";
  }

  if (kind === "rank") {
    return value.toFixed(2);
  }

  return escapeHtml(formatCompactValue(kind, value));
}

function formatCoverage(populated: number, total: number): string {
  if (total === 0) {
    return "&mdash;";
  }

  return `${Math.round((populated / total) * 100)}% (${String(populated)}/${String(total)})`;
}

function renderModeWinnerCard(section: BenchmarkComparisonSection): string {
  const winner = section.rows[0];
  if (!winner) {
    return "";
  }

  const latencyValues = winner.cells.flatMap((cell) =>
    typeof cell.metrics.avgLatency === "number" ? [cell.metrics.avgLatency] : []
  );
  const avgLatency = latencyValues.length ? average(latencyValues) ?? null : null;
  const totalCost = winner.cells.reduce((sum, cell) => sum + cell.costSummary.totalResolvedUsd, 0);
  const label = describeModelLabel(winner.modelId);

  return `
    <article class="scorecard-card">
      <header class="scorecard-card-header">
        <div>
          <p class="scorecard-eyebrow">${escapeHtml(localizedModeTitle(section.kind))}</p>
          <h3>${escapeHtml(label.primary)}</h3>
          ${label.secondary ? `<p class="scorecard-subtitle">${escapeHtml(label.secondary)}</p>` : ""}
        </div>
        <span class="scorecard-chip">Mejor resultado</span>
      </header>
      <dl class="scorecard-stats">
        <div>
          <dt>Puntuación</dt>
          <dd>${escapeHtml(winner.avgScore.toFixed(3))}</dd>
        </div>
        <div>
          <dt>Latencia de ejecución</dt>
          <dd>${avgLatency === null ? "&mdash;" : escapeHtml(formatCompactValue("ms", avgLatency))}</dd>
        </div>
        <div>
          <dt>Coste total</dt>
          <dd>${escapeHtml(formatCompactValue("usd", totalCost))}</dd>
        </div>
      </dl>
      <p class="scorecard-note">${String(winner.cells.length)} celda(s) de aplicación</p>
    </article>
  `;
}

function renderOverallLeaderboard(report: BenchmarkComparisonReport): string {
  const rankMatrix = report.summaryFigures?.rankMatrix;
  if (!rankMatrix || !rankMatrix.rows.length) {
    return "";
  }

  const body = rankMatrix.rows
    .map((row) => {
      const label = describeModelLabel(row.modelId);
      const populatedCells = row.cells.filter((cell) => !cell.missing).length;
      const totalCells = row.cells.length;

      return `
        <tr>
          <th class="leaderboard-model-cell">
            <span class="rank-model-label">${escapeHtml(label.primary)}</span>
            ${label.secondary ? `<span class="rank-model-detail">${escapeHtml(label.secondary)}</span>` : ""}
          </th>
          <td class="leaderboard-summary-cell">${formatCoverage(populatedCells, totalCells)}</td>
          <td class="leaderboard-summary-cell">${formatOverviewValue("rank", row.meanRank)}</td>
          <td class="leaderboard-summary-cell">${formatOverviewValue("score", row.meanScore)}</td>
          <td class="leaderboard-summary-cell">${formatOverviewValue("usd", row.meanTotalCost)}</td>
          <td class="leaderboard-summary-cell">${formatOverviewValue("ms", row.meanAvgLatency)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <article class="overview-figure">
      <header class="overview-header">
        <h3>Clasificación global</h3>
        <p>La cobertura cuenta las celdas pobladas en las columnas de modo y aplicación mostradas. Los modelos se ordenan por rango medio, y después por puntuación, coste y latencia de ejecución.</p>
      </header>
      <div class="table-wrap">
        <table class="leaderboard-table rank-matrix-table">
          <thead>
            <tr>
              <th class="leaderboard-model-head">Modelo</th>
              <th class="leaderboard-summary-head">Cobertura</th>
              <th class="leaderboard-summary-head">Rango medio</th>
              <th class="leaderboard-summary-head">Puntuación media</th>
              <th class="leaderboard-summary-head">Coste total medio</th>
              <th class="leaderboard-summary-head">Latencia media de ejecución</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderTopSummary(report: BenchmarkComparisonReport): string {
  if (!report.summaryFigures) {
    return "";
  }

  const cards = report.modeSections.map((section) => renderModeWinnerCard(section)).filter(Boolean).join("");
  const leaderboard = renderOverallLeaderboard(report);
  const frontier = renderEfficiencyFrontierFigure(report);

  return `
    <section class="overview-section">
      <h2>Panel de síntesis</h2>
      <p class="section-summary">Se muestran primero los mejores resultados por modo y, a continuación, la clasificación consolidada del benchmark seleccionado.</p>
      <div class="scorecard-grid">${cards}</div>
      ${leaderboard}
    </section>
    ${frontier ? `<section class="overview-section">${frontier}</section>` : ""}
  `;
}

function frontierPointRadius(
  point: BenchmarkEfficiencyFrontierPoint,
  panel: BenchmarkEfficiencyFrontierFigure["panels"][number]
): number {
  const min = Math.min(...panel.points.map((item) => item.avgScore));
  const max = Math.max(...panel.points.map((item) => item.avgScore));
  if (min === max) {
    return 11;
  }

  return 7 + ((point.avgScore - min) / (max - min)) * 9;
}

function renderEfficiencyFrontierFigure(report: BenchmarkComparisonReport): string {
  const frontier = report.summaryFigures?.efficiencyFrontier;
  if (!frontier || !frontier.panels.length) {
    return "";
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const width = 360;
  const height = 280;
  const marginLeft = 68;
  const marginRight = 22;
  const marginTop = 18;
  const marginBottom = 52;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;

  const panels = frontier.panels
    .map((panel) => {
      const grid = ticks
        .map((tick) => {
          const x = marginLeft + chartWidth * tick;
          const y = marginTop + chartHeight * (1 - tick);
          return `
            <line x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + chartHeight}" class="frontier-gridline" />
            <line x1="${marginLeft}" y1="${y}" x2="${marginLeft + chartWidth}" y2="${y}" class="frontier-gridline" />
            <text x="${x}" y="${height - 14}" class="frontier-tick" text-anchor="${
              tick === 0 ? "start" : tick === 1 ? "end" : "middle"
            }">${escapeHtml(formatCompactValue("ms", frontier.xDomain.max * tick))}</text>
            <text x="${marginLeft - 10}" y="${y + 4}" class="frontier-tick" text-anchor="end">${escapeHtml(
              formatCompactValue("usd", frontier.yDomain.max * tick)
            )}</text>
          `;
        })
        .join("");

      const pareto = panel.points
        .filter((point) => point.paretoOptimal)
        .sort(
          (left, right) =>
            left.avgLatency - right.avgLatency || left.avgCost - right.avgCost || left.modelId.localeCompare(right.modelId)
        );
      const paretoPath =
        pareto.length > 1
          ? pareto
              .map((point) => {
                const x = marginLeft + (point.avgLatency / frontier.xDomain.max) * chartWidth;
                const y = marginTop + (1 - point.avgCost / frontier.yDomain.max) * chartHeight;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ")
          : "";

      const points = panel.points
        .map((point) => {
          const x = marginLeft + (point.avgLatency / frontier.xDomain.max) * chartWidth;
          const y = marginTop + (1 - point.avgCost / frontier.yDomain.max) * chartHeight;
          const radius = frontierPointRadius(point, panel);
          return `
            <circle
              cx="${x.toFixed(2)}"
              cy="${y.toFixed(2)}"
              r="${radius.toFixed(2)}"
              class="frontier-point${point.paretoOptimal ? " frontier-point-pareto" : ""}"
              fill="${point.color}"
              stroke="${point.paretoOptimal ? "#1f1a14" : "#4f4020"}"
            />
          `;
        })
        .join("");

      return `
        <article class="frontier-panel-card">
          <header class="frontier-panel-header">
            <h4>${escapeHtml(localizedModeTitle(panel.kind))}</h4>
            <p>${escapeHtml(localizedModeShortTitle(panel.kind).toUpperCase())}</p>
          </header>
          <div class="chart-frame frontier-frame">
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(localizedModeTitle(panel.kind))} · frontera de eficiencia" xmlns="http://www.w3.org/2000/svg">
              <rect width="${width}" height="${height}" fill="#fffdfa" />
              ${grid}
              <line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${marginLeft + chartWidth}" y2="${marginTop + chartHeight}" class="frontier-axis" />
              <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + chartHeight}" class="frontier-axis" />
              ${paretoPath ? `<polyline points="${paretoPath}" class="frontier-line" />` : ""}
              ${points}
              <text x="${marginLeft + chartWidth / 2}" y="${height - 2}" class="frontier-axis-label" text-anchor="middle">Latencia media de ejecución</text>
              <text x="20" y="${marginTop + chartHeight / 2}" class="frontier-axis-label" text-anchor="middle" transform="rotate(-90 20 ${marginTop + chartHeight / 2})">Coste medio</text>
            </svg>
          </div>
        </article>
      `;
    })
    .join("");

  const legend = frontier.legend
    .map((entry) => {
      const label = describeModelLabel(entry.modelId);
      return `
        <li class="frontier-legend-item">
          <span class="frontier-legend-swatch" style="background: ${entry.color};"></span>
          <div class="frontier-legend-copy">
            <span class="frontier-legend-label">${escapeHtml(label.primary)}</span>
            ${label.secondary ? `<span class="frontier-legend-detail">${escapeHtml(label.secondary)}</span>` : ""}
          </div>
        </li>
      `;
    })
    .join("");

  return `
    <article class="overview-figure">
      <header class="overview-header">
        <h3>Frontera de eficiencia por modo</h3>
        <p>Cada panel agrega los modelos disponibles dentro de un modo. Los ejes comunes representan latencia media de ejecución y coste medio, mientras que el tamaño del punto refleja la puntuación media del modo.</p>
      </header>
      <div class="frontier-panel-grid">${panels}</div>
      <ul class="frontier-legend" aria-label="Leyenda de la frontera de eficiencia">${legend}</ul>
    </article>
  `;
}

function renderSummaryFigures(report: BenchmarkComparisonReport): string {
  return renderTopSummary(report);
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
  kind: "ms" | "usd" | "score";
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
            ${typeof item.score === "number" ? `<span class="plot-chip">Puntuación ${escapeHtml(formatCompactValue("score", item.score))}</span>` : ""}
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
          <text x="${marginLeft + chartWidth / 2}" y="${height - 4}" class="plot-axis-label" text-anchor="middle">Latencia de ejecución</text>
          <text x="24" y="${marginTop + chartHeight / 2}" class="plot-axis-label" text-anchor="middle" transform="rotate(-90 24 ${marginTop + chartHeight / 2})">Coste medio</text>
        </svg>
      </div>
      <ul class="plot-legend" aria-label="${escapeHtml(input.title)} · detalle">${legend}</ul>
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
      title: "Coste por modelo",
      subtitle: "Coste total agregado en las celdas de aplicación mostradas para este modo.",
      color: "#8b6c32",
      kind: "usd",
      sort: "desc",
      data: spendData
    }),
    renderHorizontalBarChart({
      title: "Latencia de ejecución por modelo",
      subtitle: "Latencia media de ejecución en las celdas de aplicación mostradas para este modo.",
      color: "#42577a",
      kind: "ms",
      sort: "asc",
      data: latencyData
    }),
    renderScatterChart({
      title: "Frontera coste-latencia",
      subtitle: "Cada punto representa un modelo; los puntos mayores indican una puntuación superior dentro del benchmark.",
      data: scatterData
    })
  ].filter(Boolean);

  if (!charts.length) {
    return "";
  }

  return `<div class="section-visuals">${charts.join("")}</div>`;
}

function collectAppVisualData(section: BenchmarkComparisonSection, appId: string): Array<{
  modelId: string;
  score?: number;
  avgLatency?: number;
  avgCost?: number;
}> {
  return section.rows
    .flatMap((row) => {
      const cell = row.cells.find((item) => item.appId === appId);
      if (!cell) {
        return [];
      }

      return [
        {
          modelId: row.modelId,
          score: typeof cell.metrics.score === "number" ? cell.metrics.score : undefined,
          avgLatency: typeof cell.metrics.avgLatency === "number" ? cell.metrics.avgLatency : undefined,
          avgCost: typeof cell.metrics.avgCost === "number" ? cell.metrics.avgCost : undefined
        }
      ];
    })
    .filter(
      (item) =>
        typeof item.score === "number" ||
        typeof item.avgLatency === "number" ||
        typeof item.avgCost === "number"
    );
}

function renderPerAppVisuals(section: BenchmarkComparisonSection): string {
  if (section.appIds.length <= 1) {
    return "";
  }

  const blocks = section.appIds
    .map((appId) => {
      const data = collectAppVisualData(section, appId);
      if (!data.length) {
        return "";
      }

      const scoreData = data
        .map((item) => ({
          label: item.modelId,
          value: item.score
        }))
        .filter((item): item is { label: string; value: number } => typeof item.value === "number");
      const scatterData = data
        .filter(
          (item): item is { modelId: string; score?: number; avgLatency: number; avgCost: number } =>
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
          title: `${appId} · puntuación por modelo`,
          subtitle: "Ordenación de puntuaciones restringida a la aplicación seleccionada.",
          color: "#5f8065",
          kind: "score",
          sort: "desc",
          data: scoreData
        }),
        renderScatterChart({
          title: `${appId} · coste frente a latencia`,
          subtitle: "Frontera de coste y latencia de ejecución para esta aplicación; los puntos mayores indican una puntuación superior.",
          data: scatterData
        })
      ].filter(Boolean);

      if (!charts.length) {
        return "";
      }

      return `
        <article class="app-compare-block">
          <header class="app-compare-header">
            <h4>${escapeHtml(appId)}</h4>
            <p>Comparación de modelos circunscrita a esta aplicación.</p>
          </header>
          <div class="section-visuals">${charts.join("")}</div>
        </article>
      `;
    })
    .filter(Boolean);

  if (!blocks.length) {
    return "";
  }

  return `
    <div class="per-app-visuals">
      <h3>Comparación de modelos por aplicación</h3>
      ${blocks.join("")}
    </div>
  `;
}

function renderMatrix(section: BenchmarkComparisonSection): string {
  const visibleColumns = visibleMatrixColumns(section);
  if (!visibleColumns.length) {
    return "";
  }

  const appGroups = section.appIds.map((appId, appIndex) => ({
    appId,
    appIndex,
    parityClass: appIndex % 2 === 0 ? "app-group-even" : "app-group-odd"
  }));
  const bestValuesByApp = new Map(
    appGroups.map(({ appId }) => [
      appId,
      new Map(
        visibleColumns.map((column) => {
          const direction = metricDirectionForColumn(column);
          const bestValue =
            direction === null
              ? null
              : bestMetricValue(
                  section.rows.map((row) => {
                    const cell = row.cells.find((item) => item.appId === appId);
                    const value = cell?.metrics[column.key];
                    return typeof value === "number" ? value : null;
                  }),
                  direction
                );
          return [column.key, bestValue];
        })
      )
    ])
  );

  return `
    <div class="table-wrap">
      <table class="matrix-table">
        <thead>
          <tr>
            <th rowspan="2" class="model-col">Modelo</th>
            ${appGroups
              .map(
                ({ appId, appIndex, parityClass }) =>
                  `<th colspan="${String(visibleColumns.length)}" class="group-col ${parityClass}${appIndex > 0 ? " group-start" : ""}">${escapeHtml(appId)}</th>`
              )
              .join("")}
          </tr>
          <tr>
            ${appGroups
              .map(({ appIndex, parityClass }) =>
                visibleColumns
                  .map(
                    (column, columnIndex) =>
                      `<th class="${parityClass}${columnIndex === 0 && appIndex > 0 ? " group-start" : ""}">${escapeHtml(localizedMetricLabel(column))}</th>`
                  )
                  .join("")
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
                  ${appGroups
                    .map(({ appId, appIndex, parityClass }) => {
                      const cell = cellMap.get(appId);
                      return visibleColumns
                        .map((column, columnIndex) => {
                          const metricValue = cell?.metrics[column.key] ?? null;
                          const formatted = formatMetricValue(column, metricValue, cell?.costSummary);
                          const numericValue = typeof metricValue === "number" ? metricValue : null;
                          const bestValue = bestValuesByApp.get(appId)?.get(column.key) ?? null;
                          return `<td class="${parityClass}${columnIndex === 0 && appIndex > 0 ? " group-start" : ""}">${renderBestMetric(formatted, numericValue, bestValue)}</td>`;
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
  const rows = section.rows.flatMap((row) =>
    row.cells.map((cell) => [
      cell.appId,
      row.modelId,
      formatMetricValue(
        { key: "totalCost", label: "Total Cost", kind: "usd", aggregate: "sum" },
        cell.costSummary.totalResolvedUsd,
        cell.costSummary
      )
    ])
  );
  if (!rows.length) {
    return "";
  }
  return `
    <div class="table-wrap audit-wrap">
      <table class="audit-table">
        <caption>Auditoría de coste del ${escapeHtml(localizedModeContext(section.kind))}</caption>
        <thead>
          <tr><th>Aplicación</th><th>Modelo</th><th>Coste total</th></tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `<tr><td>${escapeHtml(row[0]!)}</td><td>${escapeHtml(row[1]!)}</td><td>${row[2]}</td></tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderScoreDefinition(section: BenchmarkComparisonSection): string {
  const definition = spanishScoreDefinition(section.kind);
  if (!definition.metrics.length) {
    return "";
  }

  const rows = definition.metrics
    .map(
      (metric) => `
        <tr>
          <th>${escapeHtml(metric.label)}</th>
          <td>${escapeHtml(`${Math.round(metric.weight * 100)}%`)}</td>
          <td>${escapeHtml(metric.description)}</td>
          <td>${escapeHtml(metric.contribution)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <article class="score-explainer">
      <header class="score-explainer-header">
        <h3>Fundamento de la puntuación</h3>
        <p>${escapeHtml(definition.modeDescription)}</p>
      </header>
      <p class="score-formula"><strong>Fórmula.</strong> ${escapeHtml(definition.formula)}</p>
      <div class="table-wrap">
        <table class="score-definition-table">
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Peso</th>
              <th>Cómo se mide</th>
              <th>Por qué importa</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <ul class="section-notes">
        ${definition.specialRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderModeReadGuide(section: BenchmarkComparisonSection): string {
  const items = localizedModeReadGuide(section.kind);
  const notes = localizedSectionNotes(section.kind);

  return `
    <article class="read-guide">
      <header class="read-guide-header">
        <h3>Cómo interpretar este informe</h3>
        <p>La matriz resume resultados por aplicación dentro del modo mostrado. La comparación debe centrarse en la puntuación y en las métricas operativas que contextualizan sus compromisos.</p>
      </header>
      <div class="read-guide-grid">
        ${items
          .map(
            (item) => `
              <article class="read-guide-card">
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.body)}</p>
              </article>
            `
          )
          .join("")}
      </div>
      ${notes.length ? renderNotes(notes) : ""}
    </article>
  `;
}

function renderNotes(notes: string[]): string {
  if (!notes.length) {
    return "";
  }

  return `
    <ul class="section-notes">
      ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  `;
}

export function renderBenchmarkComparisonHtml(report: BenchmarkComparisonReport): string {
  const header = reportHeader(report, "mode");
  const primarySection = report.modeSections[0];
  const objective = primarySection
    ? `Examinar el rendimiento de los modelos en el ${localizedModeContext(primarySection.kind)} para ${String(report.appIds.length)} aplicación(es) y ${String(report.runIds.length)} ejecución(es) observadas.`
    : "Examinar el rendimiento comparado de los modelos en el conjunto de resultados disponible.";
  const method = primarySection
    ? `La interpretación debe priorizar la puntuación del ${localizedModeContext(primarySection.kind)} y contrastarla con latencia y coste como métricas de apoyo.`
    : "La interpretación combina evidencia funcional y eficiencia operativa.";
  const conclusion = primarySection ? sectionFinding(primarySection) : "No se dispone de evidencia suficiente para una conclusión comparativa.";
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(header.title)}</title>
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
        width: min(1440px, calc(100vw - 16px));
        margin: 24px auto 40px;
        padding: 24px 18px 30px;
        background: var(--paper);
        border-top: 1px solid var(--rule);
        border-bottom: 1px solid var(--rule);
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
      .provenance-block {
        margin-top: 22px;
        padding-top: 18px;
        border-top: 1px solid var(--rule);
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
      .score-explainer,
      .read-guide {
        margin: 0 0 18px;
        padding: 18px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdf8 0%, #f7f0e3 100%);
      }
      .score-explainer-header h3,
      .read-guide-header h3 {
        margin: 0;
        font-size: 1.1rem;
      }
      .score-explainer-header p,
      .read-guide-header p {
        margin: 8px 0 0;
        color: var(--muted);
        max-width: 980px;
      }
      .score-formula {
        margin: 14px 0 0;
      }
      .score-definition-table th,
      .score-definition-table td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--rule);
        text-align: left;
        vertical-align: top;
      }
      .score-definition-table thead th {
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
      }
      .read-guide-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin-top: 14px;
      }
      .read-guide-card {
        padding: 12px 14px;
        border: 1px solid rgba(119, 106, 88, 0.18);
        background: rgba(255, 253, 248, 0.78);
      }
      .read-guide-card h3,
      .read-guide-card h4 {
        margin: 0;
        font-size: 0.95rem;
      }
      .read-guide-card p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .provenance-chip {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .scorecard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
        margin: 0 0 18px;
      }
      .scorecard-card {
        padding: 16px 16px 14px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdf8 0%, #f7f0e3 100%);
      }
      .scorecard-card-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      .scorecard-eyebrow {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .scorecard-card h3 {
        margin: 0;
        font-size: 1.05rem;
      }
      .scorecard-subtitle {
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 0.8rem;
        word-break: break-word;
      }
      .scorecard-chip {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.76rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .scorecard-stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0 0;
      }
      .scorecard-stats div {
        padding: 10px 10px 9px;
        border: 1px solid rgba(119, 106, 88, 0.18);
        background: rgba(255, 253, 248, 0.78);
      }
      .scorecard-stats dt {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .scorecard-stats dd {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      .scorecard-note {
        margin: 12px 0 0;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .section-visuals {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
        gap: 16px;
        margin: 0 0 18px;
      }
      .per-app-visuals {
        margin: 4px 0 18px;
      }
      .per-app-visuals h3 {
        margin: 0 0 12px;
        font-size: 1.1rem;
      }
      .app-compare-block + .app-compare-block {
        margin-top: 18px;
      }
      .app-compare-header {
        margin-bottom: 10px;
      }
      .app-compare-header h4 {
        margin: 0;
        font-size: 1rem;
      }
      .app-compare-header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
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
      .overview-stack {
        display: grid;
        gap: 18px;
      }
      .overview-figure {
        padding: 18px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdf8 0%, #f7f0e3 100%);
      }
      .overview-header h3 {
        margin: 0;
        font-size: 1.15rem;
      }
      .overview-header p {
        margin: 8px 0 0;
        color: var(--muted);
        max-width: 1100px;
      }
      .overview-legend {
        margin: 12px 0 0;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .rank-matrix-table thead th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule-strong);
        text-align: center;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      .leaderboard-table thead th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule-strong);
        text-align: center;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      .rank-matrix-table tbody th,
      .rank-matrix-table tbody td {
        padding: 0;
        border-bottom: 1px solid var(--rule);
        text-align: center;
      }
      .leaderboard-table tbody th,
      .leaderboard-table tbody td {
        padding: 0;
        border-bottom: 1px solid var(--rule);
        text-align: center;
      }
      .rank-model-head,
      .rank-model-cell,
      .leaderboard-model-head,
      .leaderboard-model-cell {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 220px;
        padding: 12px 14px !important;
        text-align: left !important;
        background: #fcfaf6;
      }
      .rank-group-head {
        font-size: 0.96rem !important;
      }
      .rank-model-label {
        display: block;
        font-weight: 700;
        line-height: 1.25;
      }
      .rank-model-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.35;
        word-break: break-word;
      }
      .rank-cell,
      .rank-summary-cell,
      .leaderboard-summary-cell {
        min-width: 104px;
      }
      .rank-cell {
        padding: 10px 8px !important;
        color: #241c14;
      }
      .rank-cell-strong {
        color: #fffdf8;
      }
      .rank-cell-missing {
        background:
          repeating-linear-gradient(
            135deg,
            rgba(208, 199, 187, 0.65) 0,
            rgba(208, 199, 187, 0.65) 8px,
            rgba(255, 253, 248, 0.96) 8px,
            rgba(255, 253, 248, 0.96) 16px
          );
        color: var(--muted);
      }
      .rank-cell-main,
      .rank-cell-detail {
        display: block;
      }
      .rank-cell-main {
        font-size: 0.98rem;
        font-weight: 700;
      }
      .rank-cell-detail {
        margin-top: 4px;
        font-size: 0.76rem;
      }
      .rank-summary-cell {
        padding: 10px 12px !important;
        background: rgba(255, 255, 255, 0.72);
        font-size: 0.88rem;
        font-weight: 700;
      }
      .leaderboard-summary-head {
        font-size: 0.95rem !important;
      }
      .leaderboard-summary-cell {
        padding: 10px 12px !important;
        background: rgba(255, 255, 255, 0.72);
        font-size: 0.88rem;
        font-weight: 700;
      }
      .leaderboard-table .rank-model-label {
        white-space: normal;
      }
      .frontier-panel-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
        margin-top: 14px;
      }
      .frontier-panel-card {
        padding: 14px;
        border: 1px solid rgba(119, 106, 88, 0.25);
        background: rgba(255, 255, 255, 0.7);
      }
      .frontier-panel-header h4 {
        margin: 0;
        font-size: 1rem;
      }
      .frontier-panel-header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.78rem;
        letter-spacing: 0.08em;
      }
      .frontier-frame {
        margin-top: 12px;
      }
      .frontier-gridline {
        stroke: #ddd3c5;
        stroke-width: 1;
      }
      .frontier-axis {
        stroke: #776a58;
        stroke-width: 1.4;
      }
      .frontier-line {
        fill: none;
        stroke: #4f4020;
        stroke-width: 2;
        stroke-dasharray: 5 4;
      }
      .frontier-axis-label,
      .frontier-tick {
        fill: #181410;
        font-family: Georgia, "Times New Roman", serif;
      }
      .frontier-axis-label {
        font-size: 12px;
        font-weight: 700;
      }
      .frontier-tick {
        font-size: 10px;
        fill: #635949;
      }
      .frontier-point {
        fill-opacity: 0.82;
        stroke-width: 1.4;
      }
      .frontier-point-pareto {
        stroke-width: 2.2;
      }
      .frontier-legend {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px 14px;
        list-style: none;
        margin: 14px 0 0;
        padding: 0;
      }
      .frontier-legend-item {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .frontier-legend-swatch {
        flex: 0 0 auto;
        width: 12px;
        height: 12px;
        margin-top: 4px;
        border-radius: 999px;
        border: 1px solid rgba(24, 20, 16, 0.35);
      }
      .frontier-legend-copy {
        min-width: 0;
      }
      .frontier-legend-label {
        display: block;
        font-size: 0.9rem;
        font-weight: 700;
        line-height: 1.25;
      }
      .frontier-legend-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.35;
        word-break: break-word;
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
      .matrix-table .app-group-even {
        background: #f7f1e5;
      }
      .matrix-table .app-group-odd {
        background: #fffdfa;
      }
      .matrix-table .group-start {
        border-left: 3px solid #c6b395;
      }
      .matrix-table thead .group-col.group-start {
        box-shadow: inset 1px 0 0 rgba(119, 106, 88, 0.3);
      }
      .matrix-table tbody td.app-group-even,
      .matrix-table tbody td.app-group-odd {
        background-clip: padding-box;
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
      .best-score {
        font-weight: 800;
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
        .scorecard-stats {
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
        .rank-model-head,
        .rank-model-cell,
        .leaderboard-model-head,
        .leaderboard-model-cell {
          min-width: 180px;
        }
        .frontier-panel-grid {
          grid-template-columns: 1fr;
        }
        .matrix-table thead th,
        .matrix-table tbody td,
        .matrix-table tbody th,
        .rank-matrix-table thead th,
        .rank-matrix-table tbody td,
        .rank-matrix-table tbody th,
        .leaderboard-table thead th,
        .leaderboard-table tbody td,
        .leaderboard-table tbody th,
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
        <h1>${escapeHtml(header.title)}</h1>
        <p class="subtitle">${escapeHtml(header.subtitle)}</p>
        ${renderMeta(report)}
      </header>
      ${renderAcademicFrame({
        title: "Planteamiento analítico",
        summary: "La lectura del informe se formula en clave académica breve, con atención prioritaria a la evidencia sustantiva del modo evaluado.",
        objective,
        method,
        conclusion
      })}
      ${renderProvenance(report)}
      ${renderSummaryFigures(report)}
      ${report.modeSections
        .map(
          (section) => `
            <section>
              <h2>${escapeHtml(localizedModeTitle(section.kind))}</h2>
              <p class="section-summary">${escapeHtml(sectionSummary(section))}</p>
              ${renderScoreDefinition(section)}
              ${renderModeReadGuide(section)}
              ${renderSectionVisuals(section)}
              ${renderPerAppVisuals(section)}
              ${renderMatrix(section)}
              ${renderAudit(section)}
            </section>
          `
        )
        .join("")}
    </main>
  </body>
</html>`;
}

const FINAL_MODE_ORDER: ExperimentKind[] = ["qa", "explore", "heal"];

interface FinalModeDescriptor {
  kind: ExperimentKind;
  title: string;
  summary: string;
}

interface FinalModelModeStats {
  coveragePopulated: number;
  coverageTotal: number;
  meanRank: number | null;
  meanScore: number | null;
  meanLatency: number | null;
  totalCost: number | null;
}

interface FinalPerAppCell {
  missing: boolean;
  rank: number | null;
  score: number | null;
  avgLatency: number | null;
  totalCost: number | null;
}

interface FinalModelView {
  modelId: string;
  provider: string;
  modeStats: Map<ExperimentKind, FinalModelModeStats>;
  appCells: Map<string, Map<ExperimentKind, FinalPerAppCell>>;
}

interface FinalAppWinner {
  kind: ExperimentKind;
  title: string;
  modelId: string;
  provider: string;
}

interface FinalAppView {
  appId: string;
  winners: Map<ExperimentKind, FinalAppWinner>;
}

interface FinalModeWinner {
  kind: ExperimentKind;
  title: string;
  modelId: string;
  provider: string;
  avgScore: number;
  avgLatency: number | null;
  totalCost: number;
}

interface FinalReportViewModel {
  modes: FinalModeDescriptor[];
  models: FinalModelView[];
  apps: FinalAppView[];
  modeWinners: FinalModeWinner[];
}

function averageNullableValues(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number");
  if (!usable.length) {
    return null;
  }
  return average(usable) ?? null;
}

function sumNullableValues(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number");
  if (!usable.length) {
    return null;
  }
  return usable.reduce((sum, value) => sum + value, 0);
}

type FinalMatrixMetricKind = "coverage" | "rank" | "score" | "ms" | "usd";
type MetricDirection = "asc" | "desc";

function formatFinalMetricValue(kind: "rank" | "score" | "ms" | "usd", value: number | null): string {
  if (value === null) {
    return "&mdash;";
  }

  switch (kind) {
    case "rank":
      return value.toFixed(2);
    case "score":
      return escapeHtml(formatCompactValue("score", value));
    case "ms":
      return escapeHtml(formatCompactValue("ms", value));
    case "usd":
      return escapeHtml(formatCompactValue("usd", value));
  }
}

function sameMetricValue(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
}

function bestMetricValue(
  values: Array<number | null | undefined>,
  direction: MetricDirection
): number | null {
  const usable = values.filter((value): value is number => typeof value === "number");
  if (!usable.length) {
    return null;
  }
  return direction === "asc" ? Math.min(...usable) : Math.max(...usable);
}

function bestScoreValue(values: Array<number | null | undefined>): number | null {
  return bestMetricValue(values, "desc");
}

function metricDirectionForColumn(column: BenchmarkMetricColumn): MetricDirection | null {
  if (column.kind === "text") {
    return null;
  }
  if (column.kind === "ms" || column.kind === "usd") {
    return "asc";
  }
  if (column.key === "rank") {
    return "asc";
  }
  return "desc";
}

function metricDirectionForFinalKind(kind: FinalMatrixMetricKind): MetricDirection {
  switch (kind) {
    case "rank":
    case "ms":
    case "usd":
      return "asc";
    case "coverage":
    case "score":
      return "desc";
  }
}

function renderBestMetric(formatted: string, value: number | null, bestValue?: number | null): string {
  if (value === null || bestValue === null || bestValue === undefined) {
    return formatted;
  }
  return sameMetricValue(value, bestValue) ? `<strong class="best-score">${formatted}</strong>` : formatted;
}

function renderFinalMetricCell(input: {
  kind: FinalMatrixMetricKind;
  value: number | null;
  bestValue?: number | null;
  formatted?: string;
}): string {
  const formatted =
    input.formatted ??
    (input.kind === "coverage"
      ? input.value === null
        ? "&mdash;"
        : `${(input.value * 100).toFixed(0)}%`
      : formatFinalMetricValue(input.kind, input.value));

  if (input.value === null) {
    return formatted;
  }

  return renderBestMetric(formatted, input.value, input.bestValue);
}

function renderComparisonGuide(): string {
  const items = localizedComparisonGuide();

  return `
    <section>
      <h2>Guía de lectura</h2>
      <p class="section-summary">Utilice esta referencia para interpretar de forma homogénea las tablas reconstruidas por modo y por aplicación.</p>
      <div class="read-guide-grid">
        ${items
          .map(
            (item) => `
              <article class="read-guide-card">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.body)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function buildFinalReportViewModel(report: BenchmarkComparisonReport): FinalReportViewModel | null {
  const rankMatrix = report.summaryFigures?.rankMatrix;
  if (!rankMatrix) {
    return null;
  }

  const sectionsByKind = new Map(report.modeSections.map((section) => [section.kind, section]));
  const modes = FINAL_MODE_ORDER.flatMap((kind) => {
    const section = sectionsByKind.get(kind);
    return section ? [{ kind, title: localizedModeTitle(kind), summary: sectionSummary(section) }] : [];
  });

  if (modes.length < 2) {
    return null;
  }

  const models = rankMatrix.rows.map<FinalModelView>((row) => {
    const modeStats = new Map<ExperimentKind, FinalModelModeStats>();
    const appCells = new Map<string, Map<ExperimentKind, FinalPerAppCell>>();

    for (const mode of modes) {
      const cells = row.cells.filter((cell) => cell.kind === mode.kind);
      const populated = cells.filter((cell) => !cell.missing);
      modeStats.set(mode.kind, {
        coveragePopulated: populated.length,
        coverageTotal: cells.length,
        meanRank: averageNullableValues(populated.map((cell) => cell.rank)),
        meanScore: averageNullableValues(populated.map((cell) => cell.score)),
        meanLatency: averageNullableValues(populated.map((cell) => cell.avgLatency)),
        totalCost: sumNullableValues(populated.map((cell) => cell.totalCost))
      });
    }

    for (const appId of report.appIds) {
      const perMode = new Map<ExperimentKind, FinalPerAppCell>();
      for (const mode of modes) {
        const cell = row.cells.find((entry) => entry.kind === mode.kind && entry.appId === appId);
        perMode.set(mode.kind, {
          missing: !cell || cell.missing,
          rank: cell?.rank ?? null,
          score: cell?.score ?? null,
          avgLatency: cell?.avgLatency ?? null,
          totalCost: cell?.totalCost ?? null
        });
      }
      appCells.set(appId, perMode);
    }

    return {
      modelId: row.modelId,
      provider: row.provider,
      modeStats,
      appCells
    };
  });

  const apps = report.appIds.map<FinalAppView>((appId) => {
    const winners = new Map<ExperimentKind, FinalAppWinner>();
    for (const mode of modes) {
      const winner = rankMatrix.rows.find((row) =>
        row.cells.some((cell) => cell.kind === mode.kind && cell.appId === appId && cell.rank === 1)
      );
      if (!winner) {
        continue;
      }
      winners.set(mode.kind, {
        kind: mode.kind,
        title: mode.title,
        modelId: winner.modelId,
        provider: winner.provider
      });
    }

    return {
      appId,
      winners
    };
  });

  const modeWinners = modes.flatMap<FinalModeWinner>((mode) => {
    const section = sectionsByKind.get(mode.kind);
    const winner = section?.rows[0];
    if (!winner) {
      return [];
    }

    return [
      {
        kind: mode.kind,
        title: mode.title,
        modelId: winner.modelId,
        provider: winner.provider,
        avgScore: winner.avgScore,
        avgLatency: averageNullableValues(
          winner.cells.map((cell) => (typeof cell.metrics.avgLatency === "number" ? cell.metrics.avgLatency : null))
        ),
        totalCost: winner.cells.reduce((sum, cell) => sum + cell.costSummary.totalResolvedUsd, 0)
      }
    ];
  });

  return {
    modes,
    models,
    apps,
    modeWinners
  };
}

function renderProvenanceNote(report: BenchmarkComparisonReport): string {
  if (!report.provenance) {
    return "";
  }

  return `
    <p class="provenance-note">
      Política de selección <span class="provenance-chip">${escapeHtml(report.provenance.selectionPolicy)}</span>.
      ${escapeHtml(
        report.modeSections.length > 1
          ? "La reconstrucción emplea el informe más reciente por modo, aplicación y modelo; las marcas temporales pueden diferir entre secciones."
          : "La reconstrucción emplea el informe más reciente por aplicación y modelo dentro del modo mostrado; las marcas temporales pueden diferir entre celdas."
      )}
    </p>
  `;
}

function renderAtAGlance(report: BenchmarkComparisonReport, viewModel: FinalReportViewModel): string {
  const cards = [
    `
      <article class="glance-card glance-card-stat">
        <p class="glance-eyebrow">Aplicaciones</p>
        <p class="glance-value">${String(report.appIds.length)}</p>
        <p class="glance-copy">${escapeHtml(report.appIds.join(", "))}</p>
      </article>
    `,
    `
      <article class="glance-card glance-card-stat">
        <p class="glance-eyebrow">Modelos</p>
        <p class="glance-value">${String(viewModel.models.length)}</p>
        <p class="glance-copy">Ordenación unificada derivada de la matriz global de rangos del benchmark.</p>
      </article>
    `,
    `
      <article class="glance-card glance-card-stat">
        <p class="glance-eyebrow">Modos disponibles</p>
        <p class="glance-value">${String(viewModel.modes.length)}</p>
        <div class="mode-pill-list">
          ${viewModel.modes.map((mode) => `<span class="mode-pill">${escapeHtml(mode.title)}</span>`).join("")}
        </div>
      </article>
    `
  ];

  const winnerCards = viewModel.modeWinners.map((winner) => {
    const label = describeModelLabel(winner.modelId);
    return `
      <article class="glance-card glance-card-winner">
        <div class="glance-card-topline">
          <p class="glance-eyebrow">${escapeHtml(winner.title)}</p>
          <span class="winner-chip">Líder del modo</span>
        </div>
        <h3>${escapeHtml(label.primary)}</h3>
        ${label.secondary ? `<p class="glance-subtitle">${escapeHtml(label.secondary)}</p>` : ""}
        <dl class="winner-stats">
          <div>
            <dt>Puntuación media</dt>
            <dd>${escapeHtml(winner.avgScore.toFixed(3))}</dd>
          </div>
          <div>
            <dt>Latencia media de ejecución</dt>
            <dd>${winner.avgLatency === null ? "&mdash;" : escapeHtml(formatCompactValue("ms", winner.avgLatency))}</dd>
          </div>
          <div>
            <dt>Coste total</dt>
            <dd>${escapeHtml(formatCompactValue("usd", winner.totalCost))}</dd>
          </div>
        </dl>
      </article>
    `;
  });

  return `
    <section>
      <h2>Visión de conjunto</h2>
      <p class="section-summary">Este bloque resume la cobertura observada y los líderes actuales por modo. Las ausencias de modo o aplicación no se incorporan al recuento.</p>
      <div class="glance-grid">${[...cards, ...winnerCards].join("")}</div>
    </section>
  `;
}

function renderModelsAcrossModes(viewModel: FinalReportViewModel): string {
  const bestByMode = new Map(
    viewModel.modes.map((mode) => [
      mode.kind,
      {
        coverage: bestMetricValue(
          viewModel.models.map((model) => {
            const stats = model.modeStats.get(mode.kind);
            return stats && stats.coverageTotal > 0 ? stats.coveragePopulated / stats.coverageTotal : null;
          }),
          metricDirectionForFinalKind("coverage")
        ),
        rank: bestMetricValue(
          viewModel.models.map((model) => model.modeStats.get(mode.kind)?.meanRank),
          metricDirectionForFinalKind("rank")
        ),
        score: bestMetricValue(
          viewModel.models.map((model) => model.modeStats.get(mode.kind)?.meanScore),
          metricDirectionForFinalKind("score")
        ),
        usd: bestMetricValue(
          viewModel.models.map((model) => model.modeStats.get(mode.kind)?.totalCost),
          metricDirectionForFinalKind("usd")
        ),
        ms: bestMetricValue(
          viewModel.models.map((model) => model.modeStats.get(mode.kind)?.meanLatency),
          metricDirectionForFinalKind("ms")
        )
      }
    ])
  );

  return `
    <section>
      <h2>Modelos a través de los modos</h2>
      <p class="section-summary">Cada modelo aparece una sola vez. La cobertura cuenta las celdas pobladas, el rango medio se interpreta a la baja y la puntuación media a la alza; las ausencias no se agregan.</p>
      <div class="table-wrap">
        <table class="unified-table">
          <thead>
            <tr>
              <th rowspan="2" class="sticky-model-col">Modelo</th>
              ${viewModel.modes
                .map((mode) => `<th colspan="5" class="group-head">${escapeHtml(mode.title)}</th>`)
                .join("")}
            </tr>
            <tr>
              ${viewModel.modes
                .map(
                  () => `
                    <th>Cobertura</th>
                    <th>Rango medio</th>
                    <th>Puntuación media</th>
                    <th>Coste total</th>
                    <th>Latencia media de ejecución</th>
                  `
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${viewModel.models
              .map((model) => {
                const label = describeModelLabel(model.modelId);
                return `
                  <tr>
                    <th class="sticky-model-col">
                      <span class="model-label">${escapeHtml(label.primary)}</span>
                      ${label.secondary ? `<span class="model-detail">${escapeHtml(label.secondary)}</span>` : ""}
                    </th>
                    ${viewModel.modes
                      .map((mode) => {
                        const stats = model.modeStats.get(mode.kind);
                        const best = bestByMode.get(mode.kind);
                        const coverageValue = stats && stats.coverageTotal > 0 ? stats.coveragePopulated / stats.coverageTotal : null;
                        return `
                          <td>${stats ? renderFinalMetricCell({ kind: "coverage", value: coverageValue, bestValue: best?.coverage ?? null, formatted: formatCoverage(stats.coveragePopulated, stats.coverageTotal) }) : "&mdash;"}</td>
                          <td>${stats ? renderFinalMetricCell({ kind: "rank", value: stats.meanRank, bestValue: best?.rank ?? null }) : "&mdash;"}</td>
                          <td>${stats ? renderFinalMetricCell({ kind: "score", value: stats.meanScore, bestValue: best?.score ?? null }) : "&mdash;"}</td>
                          <td>${stats ? renderFinalMetricCell({ kind: "usd", value: stats.totalCost, bestValue: best?.usd ?? null }) : "&mdash;"}</td>
                          <td>${stats ? renderFinalMetricCell({ kind: "ms", value: stats.meanLatency, bestValue: best?.ms ?? null }) : "&mdash;"}</td>
                        `;
                      })
                      .join("")}
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAppWinnerChips(app: FinalAppView, modes: FinalReportViewModel["modes"]): string {
  return modes
    .map((mode) => {
      const winner = app.winners.get(mode.kind);
      const winnerLabel = winner ? describeModelLabel(winner.modelId).primary : "&mdash;";
      return `
        <span class="winner-chip">
          ${escapeHtml(mode.title)}:
          <strong>${winner ? escapeHtml(winnerLabel) : "&mdash;"}</strong>
        </span>
      `;
    })
    .join("");
}

function renderAppsAcrossModes(viewModel: FinalReportViewModel): string {
  const blocks = viewModel.apps
    .map((app) => {
      const bestByMode = new Map(
        viewModel.modes.map((mode) => [
          mode.kind,
          {
            rank: bestMetricValue(
              viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.rank),
              metricDirectionForFinalKind("rank")
            ),
            score: bestMetricValue(
              viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.score),
              metricDirectionForFinalKind("score")
            ),
            ms: bestMetricValue(
              viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.avgLatency),
              metricDirectionForFinalKind("ms")
            ),
            usd: bestMetricValue(
              viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.totalCost),
              metricDirectionForFinalKind("usd")
            )
          }
        ])
      );
      return `
        <article class="app-block">
          <header class="app-block-header">
            <div>
              <h3>${escapeHtml(app.appId)}</h3>
              <p>Rangos y métricas por aplicación, alineados entre los modos del benchmark disponibles.</p>
            </div>
            <div class="winner-chip-list">${renderAppWinnerChips(app, viewModel.modes)}</div>
          </header>
          <div class="table-wrap">
            <table class="unified-table app-mode-table">
              <thead>
                <tr>
                  <th rowspan="2" class="sticky-model-col">Modelo</th>
                  ${viewModel.modes
                    .map((mode) => `<th colspan="4" class="group-head">${escapeHtml(mode.title)}</th>`)
                    .join("")}
                </tr>
                <tr>
                  ${viewModel.modes
                    .map(
                      () => `
                        <th>Rango</th>
                        <th>Puntuación</th>
                        <th>Latencia</th>
                        <th>Coste total</th>
                      `
                    )
                    .join("")}
                </tr>
              </thead>
              <tbody>
                ${viewModel.models
                  .map((model) => {
                    const label = describeModelLabel(model.modelId);
                    const appCells = model.appCells.get(app.appId);
                    return `
                      <tr>
                        <th class="sticky-model-col">
                          <span class="model-label">${escapeHtml(label.primary)}</span>
                          ${label.secondary ? `<span class="model-detail">${escapeHtml(label.secondary)}</span>` : ""}
                        </th>
                        ${viewModel.modes
                          .map((mode) => {
                            const cell = appCells?.get(mode.kind);
                            const best = bestByMode.get(mode.kind);
                            if (!cell || cell.missing) {
                              return `<td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td>`;
                            }

                            return `
                              <td>${renderFinalMetricCell({ kind: "rank", value: cell.rank, bestValue: best?.rank ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "score", value: cell.score, bestValue: best?.score ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "ms", value: cell.avgLatency, bestValue: best?.ms ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "usd", value: cell.totalCost, bestValue: best?.usd ?? null })}</td>
                            `;
                          })
                          .join("")}
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section>
      <h2>Aplicaciones a través de los modos</h2>
      <p class="section-summary">Cada aplicación mantiene la misma ordenación de modelos para hacer visibles las brechas entre modos. El rango se interpreta a la baja y la puntuación a la alza; las celdas discontinuas indican ausencia de ejecución.</p>
      <div class="app-block-list">${blocks}</div>
    </section>
  `;
}

function renderBenchmarkMatrixBlock(report: BenchmarkComparisonReport): string {
  const leaderboard = renderOverallLeaderboard(report);
  const frontier = renderEfficiencyFrontierFigure(report);
  if (!leaderboard && !frontier) {
    return "";
  }

  return `
    <section>
      <h2>Matriz global del benchmark</h2>
      <p class="section-summary">Bloque comparativo preservado para el conjunto de modos y aplicaciones seleccionados.</p>
      <div class="benchmark-matrix-stack">
        ${leaderboard}
        ${frontier}
      </div>
    </section>
  `;
}

export function renderBenchmarkFinalComparisonHtml(report: BenchmarkComparisonReport): string {
  const viewModel = buildFinalReportViewModel(report);
  if (!viewModel) {
    return renderBenchmarkComparisonHtml(report);
  }
  const header = reportHeader(report, "benchmark-final");
  const overallLeader = viewModel.models[0];
  const overallConclusion = overallLeader
    ? `En el agregado disponible, ${overallLeader.modelId} ocupa la mejor posición media dentro de la matriz comparativa.`
    : "El agregado disponible no permite establecer un liderazgo global robusto.";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(header.title)}</title>
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
        background:
          radial-gradient(circle at top right, rgba(139, 108, 50, 0.08), transparent 28%),
          linear-gradient(180deg, #f3eee5 0%, #efe7d9 100%);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(1480px, calc(100vw - 16px));
        margin: 24px auto 40px;
        padding: 24px 18px 30px;
        background: var(--paper);
        border-top: 1px solid var(--rule);
        border-bottom: 1px solid var(--rule);
        box-shadow: 0 20px 60px rgba(24, 20, 16, 0.08);
      }
      .report-header {
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
        max-width: 1100px;
      }
      .provenance-note {
        margin: 18px 0 0;
        color: var(--muted);
      }
      .provenance-chip {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .glance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
      }
      .read-guide-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .read-guide-card {
        padding: 14px 16px;
        border: 1px solid var(--rule);
        background: #fffdfa;
      }
      .read-guide-card h3 {
        margin: 0;
        font-size: 0.95rem;
      }
      .read-guide-card p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .glance-card {
        padding: 16px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdf8 0%, #f7f0e3 100%);
      }
      .glance-card-stat {
        display: none;
      }
      .glance-eyebrow {
        margin: 0;
        color: var(--muted);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .glance-value {
        margin: 10px 0 6px;
        font-size: 2rem;
        line-height: 1;
      }
      .glance-copy,
      .glance-subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .mode-pill-list,
      .winner-chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .mode-pill,
      .winner-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 1.9rem;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #4f4020;
        font-size: 0.78rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .glance-card-topline {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .glance-card h3,
      .app-block h3 {
        margin: 10px 0 0;
        font-size: 1.08rem;
      }
      .winner-stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0 0;
      }
      .winner-stats div {
        padding: 10px 10px 9px;
        border: 1px solid rgba(119, 106, 88, 0.18);
        background: rgba(255, 253, 248, 0.78);
      }
      .winner-stats dt {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .winner-stats dd {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      .unified-table thead th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule-strong);
        text-align: center;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      .unified-table tbody td,
      .unified-table tbody th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule);
        text-align: center;
        font-size: 0.92rem;
        white-space: nowrap;
      }
      .unified-table .sticky-model-col {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 250px;
        text-align: left;
        background: var(--paper);
      }
      .unified-table thead .sticky-model-col {
        z-index: 2;
      }
      .group-head {
        background: #f7f1e5;
      }
      .best-score {
        font-weight: 800;
      }
      .model-label,
      .rank-model-label,
      .frontier-legend-label {
        display: block;
        font-weight: 700;
        line-height: 1.25;
      }
      .model-detail,
      .rank-model-detail,
      .frontier-legend-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.35;
        word-break: break-word;
      }
      .mode-cell-missing {
        color: var(--muted);
        background:
          repeating-linear-gradient(
            135deg,
            rgba(208, 199, 187, 0.4) 0,
            rgba(208, 199, 187, 0.4) 8px,
            rgba(255, 253, 248, 0.96) 8px,
            rgba(255, 253, 248, 0.96) 16px
          );
      }
      .app-block-list {
        display: grid;
        gap: 18px;
      }
      .app-block {
        padding: 16px;
        border: 1px solid var(--rule);
        background: #fffdfa;
      }
      .app-block-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 12px;
      }
      .app-block-header p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .benchmark-matrix-stack {
        display: grid;
        gap: 18px;
      }
      .overview-figure {
        padding: 18px;
        border: 1px solid var(--rule);
        background: linear-gradient(180deg, #fffdf8 0%, #f7f0e3 100%);
      }
      .overview-header h3 {
        margin: 0;
        font-size: 1.15rem;
      }
      .overview-header p {
        margin: 8px 0 0;
        color: var(--muted);
        max-width: 1100px;
      }
      .rank-matrix-table thead th,
      .leaderboard-table thead th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule-strong);
        text-align: center;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      .rank-matrix-table tbody th,
      .rank-matrix-table tbody td,
      .leaderboard-table tbody th,
      .leaderboard-table tbody td {
        padding: 0;
        border-bottom: 1px solid var(--rule);
        text-align: center;
      }
      .rank-model-head,
      .rank-model-cell,
      .leaderboard-model-head,
      .leaderboard-model-cell {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 220px;
        padding: 12px 14px !important;
        text-align: left !important;
        background: #fcfaf6;
      }
      .leaderboard-summary-head {
        font-size: 0.95rem !important;
      }
      .leaderboard-summary-cell {
        padding: 10px 12px !important;
        background: rgba(255, 255, 255, 0.72);
        font-size: 0.88rem;
        font-weight: 700;
      }
      .leaderboard-table .rank-model-label {
        white-space: normal;
      }
      .frontier-panel-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
        margin-top: 14px;
      }
      .frontier-panel-card {
        padding: 14px;
        border: 1px solid rgba(119, 106, 88, 0.25);
        background: rgba(255, 255, 255, 0.7);
      }
      .frontier-panel-header h4 {
        margin: 0;
        font-size: 1rem;
      }
      .frontier-panel-header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.78rem;
        letter-spacing: 0.08em;
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
      .frontier-gridline {
        stroke: #ddd3c5;
        stroke-width: 1;
      }
      .frontier-axis {
        stroke: #776a58;
        stroke-width: 1.4;
      }
      .frontier-line {
        fill: none;
        stroke: #4f4020;
        stroke-width: 2;
        stroke-dasharray: 5 4;
      }
      .frontier-axis-label,
      .frontier-tick {
        fill: #181410;
        font-family: Georgia, "Times New Roman", serif;
      }
      .frontier-axis-label {
        font-size: 12px;
        font-weight: 700;
      }
      .frontier-tick {
        font-size: 10px;
        fill: #635949;
      }
      .frontier-point {
        fill-opacity: 0.82;
        stroke-width: 1.4;
      }
      .frontier-point-pareto {
        stroke-width: 2.2;
      }
      .frontier-legend {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px 14px;
        list-style: none;
        margin: 14px 0 0;
        padding: 0;
      }
      .frontier-legend-item {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .frontier-legend-swatch {
        flex: 0 0 auto;
        width: 12px;
        height: 12px;
        margin-top: 4px;
        border-radius: 999px;
        border: 1px solid rgba(24, 20, 16, 0.35);
      }
      .frontier-legend-copy {
        min-width: 0;
      }
      @media (max-width: 960px) {
        main {
          width: calc(100vw - 16px);
          margin: 8px auto 18px;
          padding: 18px 14px 24px;
        }
        .winner-stats {
          grid-template-columns: 1fr;
        }
        .app-block-header {
          flex-direction: column;
        }
        .unified-table .sticky-model-col,
        .rank-model-head,
        .rank-model-cell,
        .leaderboard-model-head,
        .leaderboard-model-cell {
          min-width: 180px;
        }
        .frontier-panel-grid {
          grid-template-columns: 1fr;
        }
        .unified-table thead th,
        .unified-table tbody td,
        .unified-table tbody th,
        .rank-matrix-table thead th,
        .rank-matrix-table tbody td,
        .rank-matrix-table tbody th,
        .leaderboard-table thead th,
        .leaderboard-table tbody td,
        .leaderboard-table tbody th {
          padding: 8px 9px;
          font-size: 0.85rem;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="report-header">
        <h1>${escapeHtml(header.title)}</h1>
        <p class="subtitle">${escapeHtml(header.subtitle)}</p>
        ${renderMeta(report)}
        ${renderProvenanceNote(report)}
      </header>
      ${renderAcademicFrame({
        title: "Marco interpretativo",
        summary: "Esta versión integra una lectura sintética del benchmark y mantiene separadas la comparación intramodo de puntuaciones y la comparación intermodo mediante rangos.",
        objective: `Sintetizar ${String(report.runIds.length)} ejecuciones del benchmark sobre ${String(report.appIds.length)} aplicaciones y ${String(viewModel.modes.length)} modos analíticos.`,
        method:
          "Las puntuaciones brutas solo son comparables dentro de cada modo; para la lectura transversal deben priorizarse el rango medio, la cobertura y las métricas operativas.",
        conclusion: overallConclusion
      })}
      ${renderComparisonGuide()}
      ${renderAtAGlance(report, viewModel)}
      ${renderModelsAcrossModes(viewModel)}
      ${renderAppsAcrossModes(viewModel)}
      ${renderBenchmarkMatrixBlock(report)}
    </main>
  </body>
</html>`;
}

function compareNullableFinalAsc(left: number | null, right: number | null): number {
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

function compareNullableFinalDesc(left: number | null, right: number | null): number {
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

function renderStandardizedModeTables(report: BenchmarkComparisonReport, viewModel: FinalReportViewModel): string {
  const blocks = viewModel.modes
    .map((mode) => {
      const sortedModels = [...viewModel.models].sort((left, right) => {
        const leftStats = left.modeStats.get(mode.kind);
        const rightStats = right.modeStats.get(mode.kind);
        return (
          compareNullableFinalAsc(leftStats?.meanRank ?? null, rightStats?.meanRank ?? null) ||
          compareNullableFinalDesc(leftStats?.meanScore ?? null, rightStats?.meanScore ?? null) ||
          compareNullableFinalAsc(leftStats?.totalCost ?? null, rightStats?.totalCost ?? null) ||
          compareNullableFinalAsc(leftStats?.meanLatency ?? null, rightStats?.meanLatency ?? null) ||
          left.modelId.localeCompare(right.modelId)
        );
      });
      const bestMeanCoverage = bestMetricValue(
        sortedModels.map((model) => {
          const stats = model.modeStats.get(mode.kind);
          return stats && stats.coverageTotal > 0 ? stats.coveragePopulated / stats.coverageTotal : null;
        }),
        metricDirectionForFinalKind("coverage")
      );
      const bestMeanRank = bestMetricValue(
        sortedModels.map((model) => model.modeStats.get(mode.kind)?.meanRank),
        metricDirectionForFinalKind("rank")
      );
      const bestMeanScore = bestScoreValue(sortedModels.map((model) => model.modeStats.get(mode.kind)?.meanScore));
      const bestMeanLatency = bestMetricValue(
        sortedModels.map((model) => model.modeStats.get(mode.kind)?.meanLatency),
        metricDirectionForFinalKind("ms")
      );
      const bestTotalCost = bestMetricValue(
        sortedModels.map((model) => model.modeStats.get(mode.kind)?.totalCost),
        metricDirectionForFinalKind("usd")
      );
      const bestRankByApp = new Map(
        report.appIds.map((appId) => [
          appId,
          bestMetricValue(
            sortedModels.map((model) => model.appCells.get(appId)?.get(mode.kind)?.rank),
            metricDirectionForFinalKind("rank")
          )
        ])
      );
      const bestScoreByApp = new Map(
        report.appIds.map((appId) => [
          appId,
          bestScoreValue(sortedModels.map((model) => model.appCells.get(appId)?.get(mode.kind)?.score))
        ])
      );

      return `
        <article class="mode-block">
          <header class="mode-block-header">
            <h3>${escapeHtml(mode.title)}</h3>
            <p>${escapeHtml(mode.summary)}</p>
          </header>
          <div class="table-wrap">
            <table class="unified-table standardized-mode-table">
              <thead>
                <tr>
                  <th rowspan="2" class="sticky-model-col">Modelo</th>
                  <th rowspan="2">Cobertura</th>
                  <th rowspan="2">Rango medio</th>
                  <th rowspan="2">Puntuación media</th>
                  <th rowspan="2">Latencia media de ejecución</th>
                  <th rowspan="2">Coste total</th>
                  ${report.appIds.map((appId) => `<th colspan="2" class="group-head">${escapeHtml(appId)}</th>`).join("")}
                </tr>
                <tr>
                  ${report.appIds.map(() => "<th>Rango</th><th>Puntuación</th>").join("")}
                </tr>
              </thead>
              <tbody>
                ${sortedModels
                  .map((model) => {
                    const label = describeModelLabel(model.modelId);
                    const stats = model.modeStats.get(mode.kind);
                    const coverageValue = stats && stats.coverageTotal > 0 ? stats.coveragePopulated / stats.coverageTotal : null;
                    return `
                      <tr>
                        <th class="sticky-model-col">
                          <span class="model-label">${escapeHtml(label.primary)}</span>
                          ${label.secondary ? `<span class="model-detail">${escapeHtml(label.secondary)}</span>` : ""}
                        </th>
                        <td>${stats ? renderFinalMetricCell({ kind: "coverage", value: coverageValue, bestValue: bestMeanCoverage, formatted: formatCoverage(stats.coveragePopulated, stats.coverageTotal) }) : "&mdash;"}</td>
                        <td>${stats ? renderFinalMetricCell({ kind: "rank", value: stats.meanRank, bestValue: bestMeanRank }) : "&mdash;"}</td>
                        <td>${stats ? renderFinalMetricCell({ kind: "score", value: stats.meanScore, bestValue: bestMeanScore }) : "&mdash;"}</td>
                        <td>${stats ? renderFinalMetricCell({ kind: "ms", value: stats.meanLatency, bestValue: bestMeanLatency }) : "&mdash;"}</td>
                        <td>${stats ? renderFinalMetricCell({ kind: "usd", value: stats.totalCost, bestValue: bestTotalCost }) : "&mdash;"}</td>
                        ${report.appIds
                          .map((appId) => {
                            const cell = model.appCells.get(appId)?.get(mode.kind);
                            if (!cell || cell.missing) {
                              return `<td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td>`;
                            }
                            return `
                              <td>${renderFinalMetricCell({ kind: "rank", value: cell.rank, bestValue: bestRankByApp.get(appId) ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "score", value: cell.score, bestValue: bestScoreByApp.get(appId) ?? null })}</td>
                            `;
                          })
                          .join("")}
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section>
      <h2>Resultados normalizados por modo</h2>
      <p class="section-summary">Cada modo utiliza la misma estructura tabular para facilitar una lectura homogénea de rangos, cobertura y puntuaciones por aplicación. Los valores en negrita señalan el mejor resultado comparable de cada columna.</p>
      <div class="mode-block-list">${blocks}</div>
    </section>
  `;
}

function renderStandardizedAppComparisons(viewModel: FinalReportViewModel): string {
  const blocks = viewModel.apps
    .map((app) => {
      const bestRankByMode = new Map(
        viewModel.modes.map((mode) => [
          mode.kind,
          bestMetricValue(
            viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.rank),
            metricDirectionForFinalKind("rank")
          )
        ])
      );
      const bestScoreByMode = new Map(
        viewModel.modes.map((mode) => [
          mode.kind,
          bestScoreValue(viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.score))
        ])
      );
      const bestLatencyByMode = new Map(
        viewModel.modes.map((mode) => [
          mode.kind,
          bestMetricValue(
            viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.avgLatency),
            metricDirectionForFinalKind("ms")
          )
        ])
      );
      const bestCostByMode = new Map(
        viewModel.modes.map((mode) => [
          mode.kind,
          bestMetricValue(
            viewModel.models.map((model) => model.appCells.get(app.appId)?.get(mode.kind)?.totalCost),
            metricDirectionForFinalKind("usd")
          )
        ])
      );
      return `
        <article class="app-block">
          <header class="app-block-header">
            <div>
              <h3>${escapeHtml(app.appId)}</h3>
              <p>Compare el mismo modelo a través de los modos disponibles para esta aplicación. Los valores en negrita marcan el mejor resultado comparable de cada columna modal.</p>
            </div>
            <div class="winner-chip-list">${renderAppWinnerChips(app, viewModel.modes)}</div>
          </header>
          <div class="table-wrap">
            <table class="unified-table app-mode-table">
              <thead>
                <tr>
                  <th rowspan="2" class="sticky-model-col">Modelo</th>
                  ${viewModel.modes
                    .map((mode) => `<th colspan="4" class="group-head">${escapeHtml(mode.title)}</th>`)
                    .join("")}
                </tr>
                <tr>
                  ${viewModel.modes.map(() => "<th>Rango</th><th>Puntuación</th><th>Latencia</th><th>Coste total</th>").join("")}
                </tr>
              </thead>
              <tbody>
                ${viewModel.models
                  .map((model) => {
                    const label = describeModelLabel(model.modelId);
                    const appCells = model.appCells.get(app.appId);
                    return `
                      <tr>
                        <th class="sticky-model-col">
                          <span class="model-label">${escapeHtml(label.primary)}</span>
                          ${label.secondary ? `<span class="model-detail">${escapeHtml(label.secondary)}</span>` : ""}
                        </th>
                        ${viewModel.modes
                          .map((mode) => {
                            const cell = appCells?.get(mode.kind);
                            if (!cell || cell.missing) {
                              return `<td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td><td class="mode-cell-missing">&mdash;</td>`;
                            }

                            return `
                              <td>${renderFinalMetricCell({ kind: "rank", value: cell.rank, bestValue: bestRankByMode.get(mode.kind) ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "score", value: cell.score, bestValue: bestScoreByMode.get(mode.kind) ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "ms", value: cell.avgLatency, bestValue: bestLatencyByMode.get(mode.kind) ?? null })}</td>
                              <td>${renderFinalMetricCell({ kind: "usd", value: cell.totalCost, bestValue: bestCostByMode.get(mode.kind) ?? null })}</td>
                            `;
                          })
                          .join("")}
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section>
      <h2>Comparación del rendimiento por aplicación</h2>
      <p class="section-summary">Tras la vista por modo, cada aplicación dispone de una tabla específica para comparar el comportamiento de todos los modelos. El rango se interpreta a la baja, la puntuación a la alza y las celdas discontinuas indican ausencia de ejecución.</p>
      <div class="app-block-list">${blocks}</div>
    </section>
  `;
}

export function renderBenchmarkStandardizedComparisonHtml(report: BenchmarkComparisonReport): string {
  const viewModel = buildFinalReportViewModel(report);
  if (!viewModel) {
    return renderBenchmarkComparisonHtml(report);
  }
  const header = reportHeader(report, "benchmark-standardized");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(header.title)}</title>
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
        background:
          linear-gradient(180deg, rgba(139, 108, 50, 0.06) 0%, transparent 16%),
          linear-gradient(180deg, #f3eee5 0%, #efe7d9 100%);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(1520px, calc(100vw - 16px));
        margin: 24px auto 40px;
        padding: 24px 18px 30px;
        background: var(--paper);
        border-top: 1px solid var(--rule);
        border-bottom: 1px solid var(--rule);
        box-shadow: 0 20px 60px rgba(24, 20, 16, 0.08);
      }
      .report-header {
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
      h3 {
        margin: 0;
        font-size: 1.08rem;
      }
      .section-summary {
        margin: 8px 0 16px;
        color: var(--muted);
        max-width: 1100px;
      }
      .provenance-note {
        margin: 18px 0 0;
        color: var(--muted);
      }
      .read-guide-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .read-guide-card {
        padding: 14px 16px;
        border: 1px solid var(--rule);
        background: #fffdfa;
      }
      .read-guide-card h3 {
        margin: 0;
        font-size: 0.95rem;
      }
      .read-guide-card p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .provenance-chip,
      .winner-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 1.9rem;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #4f4020;
        font-size: 0.78rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .provenance-chip {
        min-height: auto;
        padding: 2px 8px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      .unified-table thead th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule-strong);
        text-align: center;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      .unified-table tbody td,
      .unified-table tbody th {
        padding: 10px 12px;
        border-bottom: 1px solid var(--rule);
        text-align: center;
        font-size: 0.92rem;
        white-space: nowrap;
      }
      .unified-table .sticky-model-col {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 250px;
        text-align: left;
        background: var(--paper);
      }
      .unified-table thead .sticky-model-col {
        z-index: 2;
      }
      .group-head {
        background: #f7f1e5;
      }
      .best-score {
        font-weight: 800;
      }
      .model-label {
        display: block;
        font-weight: 700;
        line-height: 1.25;
      }
      .model-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.35;
        word-break: break-word;
      }
      .mode-cell-missing {
        color: var(--muted);
        background:
          repeating-linear-gradient(
            135deg,
            rgba(208, 199, 187, 0.4) 0,
            rgba(208, 199, 187, 0.4) 8px,
            rgba(255, 253, 248, 0.96) 8px,
            rgba(255, 253, 248, 0.96) 16px
          );
      }
      .mode-block-list,
      .app-block-list {
        display: grid;
        gap: 18px;
      }
      .mode-block,
      .app-block {
        padding: 16px;
        border: 1px solid var(--rule);
        background: #fffdfa;
      }
      .mode-block-header p,
      .app-block-header p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .app-block-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 12px;
      }
      .winner-chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      @media (max-width: 960px) {
        main {
          width: calc(100vw - 16px);
          margin: 8px auto 18px;
          padding: 18px 14px 24px;
        }
        .app-block-header {
          flex-direction: column;
        }
        .unified-table .sticky-model-col {
          min-width: 180px;
        }
        .unified-table thead th,
        .unified-table tbody td,
        .unified-table tbody th {
          padding: 8px 9px;
          font-size: 0.85rem;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="report-header">
        <h1>${escapeHtml(header.title)}</h1>
        <p class="subtitle">${escapeHtml(header.subtitle)}</p>
        ${renderMeta(report)}
        ${renderProvenanceNote(report)}
      </header>
      ${renderAcademicFrame({
        title: "Criterio de estandarización",
        summary: "La tabla normalizada homogeneiza la lectura por modo y desplaza la comparación intermodo al plano del rango, no al de la puntuación bruta.",
        objective: `Uniformar la lectura de ${String(report.runIds.length)} ejecuciones y facilitar la comparación por modo y por aplicación.`,
        method:
          "Cada bloque por modo mantiene una estructura constante; después, cada aplicación se revisa con la misma ordenación de modelos para hacer visibles las diferencias entre modos.",
        conclusion:
          "La lectura estandarizada permite detectar rápidamente liderazgos, vacíos de cobertura y compromisos entre eficacia, coste y latencia."
      })}
      ${renderComparisonGuide()}
      ${renderStandardizedModeTables(report, viewModel)}
      ${renderStandardizedAppComparisons(viewModel)}
    </main>
  </body>
</html>`;
}
