import { describe, expect, it } from "vitest";
import { renderPaperReport } from "../../src/experiments/report-html.js";

describe("paper report renderer", () => {
  it("renders paper sections, unified figure markup, tables, and appendix", () => {
    const html = renderPaperReport({
      title: "Todo React Guided Mode Report",
      subtitle: "Guided scenario execution across 2 model(s).",
      abstract: "This report summarizes guided benchmark performance.",
      meta: [
        { label: "Run ID", value: "qa-demo-run" },
        { label: "Models", value: "2" }
      ],
      sections: [
        {
          title: "Experiment Setup",
          body: ["This section describes the guided benchmark setup."],
          facts: [{ label: "Tasks", value: "7" }]
        }
      ],
      figure: {
        title: "Unified Guided Figure",
        caption: "Baseline application state plus one representative result per model.",
        panels: [
          {
            label: "A",
            title: "Test App Baseline",
            subtitle: "smoke-home-title",
            metrics: [{ label: "Outcome", value: "Passed" }],
            caption: "Baseline AUT state."
          },
          {
            label: "B",
            title: "google/gemini-2.5-flash",
            metrics: [{ label: "Score", value: "88.922" }],
            badges: ["Capability 100.0%"],
            caption: "Representative guided result."
          }
        ]
      },
      charts: [
        {
          title: "Exact Guided Cost",
          caption: "Total guided benchmark cost per model.",
          svgMarkup: "<svg viewBox='0 0 10 10'><rect width='10' height='10' /></svg>",
          note: "All values resolved from gateway generation lookups."
        }
      ],
      tables: [
        {
          title: "Quantitative Results",
          columns: ["Rank", "Model", "Score"],
          rows: [["1", "google/gemini-2.5-flash", "88.922"]]
        }
      ],
      appendix: [
        {
          title: "google/gemini-2.5-flash",
          body: ["Task pass rate was 100.0%."],
          facts: [{ label: "Executed Tasks", value: "7" }]
        }
      ]
    });

    expect(html).toContain("Abstract");
    expect(html).toContain("1. Experiment Setup");
    expect(html).toContain("2. Unified Guided Figure");
    expect(html).toContain("3. Exact Guided Cost");
    expect(html).toContain("Figure 1.");
    expect(html).toContain("Figure 2.");
    expect(html).toContain("Quantitative Results");
    expect(html).toContain("Appendix");
    expect(html).toContain("figure-panel");
  });
});
