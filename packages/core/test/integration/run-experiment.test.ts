import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MockAutomationRunner } from "../../src/runner/mock-runner.js";
import { runExperiment } from "../../src/service.js";

const tempDirs: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function startLocalAut(): Promise<string> {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.includes("/docs")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>QA Demo Docs</title></head><body>Documentation</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><head><title>QA Demo</title></head><body>New item</body></html>");
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve local server port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("runExperiment integration", () => {
  it("runs full benchmark pipeline and persists artifacts", async () => {
    const autUrl = await startLocalAut();
    const dir = await mkdtemp(join(tmpdir(), "agentic-qa-"));
    tempDirs.push(dir);

    const modelsPath = join(dir, "models.yaml");
    const syntheticPath = join(dir, "synthetic.json");
    const generatedPath = join(dir, "generated.json");
    const reportsDir = join(dir, "reports");
    const outputDir = join(dir, "artifacts");

    await writeFile(
      modelsPath,
      [
        "default_model: google/gemini-2.5-flash",
        "models:",
        "  - id: google/gemini-2.5-flash",
        "    provider: google",
        "    enabled: true",
        "  - id: openai/gpt-4o-mini",
        "    provider: openai",
        "    enabled: true"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      syntheticPath,
      JSON.stringify(
        {
          experiment_id: "synthetic",
          source: "synthetic",
          tasks: [
            {
              id: "task-title",
              instruction: "Open the page and validate title",
              expected: { type: "contains", value: "QA Demo" }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      generatedPath,
      JSON.stringify(
        {
          experiment_id: "generated",
          source: "generated",
          tasks: [
            {
              id: "task-docs",
              instruction: "Navigate to docs page",
              expected: { type: "url_contains", value: "/docs" }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runExperiment({
      modelsPath,
      reportsDir,
      runner: new MockAutomationRunner(11),
      spec: {
        experimentId: "integration-suite",
        aut: { url: autUrl },
        corpusPaths: [syntheticPath, generatedPath],
        tasks: [],
        trials: 2,
        outputDir,
        timeoutMs: 10_000,
        retryCount: 0,
        maxSteps: 10,
        viewport: { width: 1280, height: 720 },
        seed: 11
      }
    });

    expect(result.artifact.modelSummaries).toHaveLength(2);
    expect(result.report.leaderboard).toHaveLength(2);
    expect(result.artifact.findings.length).toBeGreaterThanOrEqual(0);

    const artifactRaw = await readFile(result.artifactPath, "utf8");
    const reportRaw = await readFile(result.reportPath, "utf8");
    expect(artifactRaw).toContain("\"runId\"");
    expect(reportRaw).toContain("\"leaderboard\"");
  });

  it("is reproducible for fixed seed and mock runner", async () => {
    const autUrl = await startLocalAut();
    const dir = await mkdtemp(join(tmpdir(), "agentic-qa-repro-"));
    tempDirs.push(dir);

    const modelsPath = join(dir, "models.yaml");
    await writeFile(
      modelsPath,
      [
        "default_model: google/gemini-2.5-flash",
        "models:",
        "  - id: google/gemini-2.5-flash",
        "    provider: google",
        "    enabled: true"
      ].join("\n"),
      "utf8"
    );

    const spec = {
      experimentId: "repro-suite",
      aut: { url: autUrl },
      tasks: [
        {
          id: "t1",
          source: "synthetic" as const,
          instruction: "check title",
          expected: { type: "contains" as const, value: "QA Demo" }
        }
      ],
      corpusPaths: [],
      trials: 3,
      outputDir: join(dir, "artifacts"),
      timeoutMs: 5_000,
      retryCount: 0,
      maxSteps: 10,
      viewport: { width: 1200, height: 800 },
      seed: 99
    };

    const first = await runExperiment({
      modelsPath,
      reportsDir: join(dir, "reports-1"),
      runner: new MockAutomationRunner(99),
      spec
    });
    const second = await runExperiment({
      modelsPath,
      reportsDir: join(dir, "reports-2"),
      runner: new MockAutomationRunner(99),
      spec
    });

    expect(first.report.leaderboard[0].score).toBe(second.report.leaderboard[0].score);
    expect(first.artifact.modelSummaries[0].metrics.passRate).toBe(
      second.artifact.modelSummaries[0].metrics.passRate
    );
  });
});

