import type { CostGraph } from "./types.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUsd(value?: number, options?: { unavailable?: boolean; noAiCalls?: boolean }): string {
  if (options?.noAiCalls) {
    return "No AI calls";
  }
  if (options?.unavailable || typeof value !== "number") {
    return "Unavailable";
  }
  return `$${value.toFixed(4)}`;
}

export function renderCostGraphSvg(graph: CostGraph): string {
  const width = 980;
  const marginLeft = 240;
  const marginRight = 120;
  const chartWidth = width - marginLeft - marginRight;
  const rowHeight = 48;
  const legendHeight = graph.series.length > 0 ? 50 : 18;
  const axisHeight = 44;
  const topPadding = 18;
  const height = topPadding + legendHeight + graph.data.length * rowHeight + axisHeight + 24;
  const totals = graph.data.map((datum) =>
    typeof datum.totalUsd === "number" ? datum.totalUsd : Object.values(datum.values).reduce((sum, value) => sum + value, 0)
  );
  const maxValue = Math.max(...totals, 0.0001);
  const legendY = topPadding;
  const chartTop = topPadding + legendHeight;
  const axisY = chartTop + graph.data.length * rowHeight + 8;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const legend = graph.series
    .map((series, index) => {
      const x = marginLeft + index * 170;
      return [
        `<rect x="${x}" y="${legendY}" width="14" height="14" rx="3" fill="${series.color}" />`,
        `<text x="${x + 22}" y="${legendY + 11}" fill="#5c5448" font-size="13">${escapeXml(series.label)}</text>`
      ].join("");
    })
    .join("");

  const bars = graph.data
    .map((datum, index) => {
      const y = chartTop + index * rowHeight;
      const totalUsd =
        typeof datum.totalUsd === "number"
          ? datum.totalUsd
          : Object.values(datum.values).reduce((sum, value) => sum + value, 0);
      let currentX = marginLeft;
      const segments = graph.series
        .map((series) => {
          const rawValue = datum.values[series.key] ?? 0;
          const segmentWidth = totalUsd > 0 ? (rawValue / maxValue) * chartWidth : 0;
          const markup =
            segmentWidth > 0
              ? `<rect x="${currentX}" y="${y + 10}" width="${segmentWidth}" height="18" rx="6" fill="${series.color}" />`
              : "";
          currentX += segmentWidth;
          return markup;
        })
        .join("");

      const valueLabel = formatUsd(datum.totalUsd, {
        unavailable: datum.costSource === "unavailable",
        noAiCalls: datum.callCount === 0
      });
      const note = datum.note
        ? `<text x="${marginLeft}" y="${y + 42}" fill="#8f8577" font-size="11">${escapeXml(datum.note)}</text>`
        : "";

      return [
        `<text x="${marginLeft - 12}" y="${y + 23}" fill="#181511" font-size="13" font-weight="600" text-anchor="end">${escapeXml(datum.modelId)}</text>`,
        `<rect x="${marginLeft}" y="${y + 10}" width="${chartWidth}" height="18" rx="6" fill="#f1ebe1" />`,
        segments,
        datum.costSource === "unavailable"
          ? `<rect x="${marginLeft}" y="${y + 10}" width="${chartWidth}" height="18" rx="6" fill="none" stroke="#c4b7a4" stroke-dasharray="5 4" />`
          : "",
        `<text x="${width - marginRight + 10}" y="${y + 23}" fill="#181511" font-size="13">${escapeXml(valueLabel)}</text>`,
        note
      ].join("");
    })
    .join("");

  const axis = ticks
    .map((tick) => {
      const x = marginLeft + chartWidth * tick;
      return [
        `<line x1="${x}" y1="${chartTop - 6}" x2="${x}" y2="${axisY - 8}" stroke="#ddd3c5" stroke-width="1" />`,
        `<text x="${x}" y="${axisY + 16}" fill="#6a6258" font-size="12" text-anchor="${tick === 0 ? "start" : tick === 1 ? "end" : "middle"}">${escapeXml(`$${(maxValue * tick).toFixed(4)}`)}</text>`
      ].join("");
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(graph.title)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#fffdfa" />
  ${legend}
  ${bars}
  ${axis}
</svg>`;
}
