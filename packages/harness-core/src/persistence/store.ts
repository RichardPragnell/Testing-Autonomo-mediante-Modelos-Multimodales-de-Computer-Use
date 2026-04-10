import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import type { DiagnosisArtifacts, ExplorationArtifact, ScenarioRunResult } from "../types.js";

export function runDirectory(resultsRoot: string, runId: string): string {
  return join(resultsRoot, "runs", runId);
}

function safePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "artifact";
}

async function persistExplorationFiles(baseDir: string, artifact: ExplorationArtifact): Promise<string> {
  await ensureDir(baseDir);
  const artifactPath = join(baseDir, "exploration.json");
  await writeJson(artifactPath, artifact);
  await writeJson(join(baseDir, "history.json"), artifact.history);
  await writeJson(join(baseDir, "pages.json"), artifact.pages);
  await writeJson(join(baseDir, "graph.json"), artifact.coverageGraph);
  await writeJson(join(baseDir, "observe-cache.json"), artifact.observeCache);
  await writeJson(join(baseDir, "action-cache.json"), artifact.actionCache);
  if (artifact.cacheSummary) {
    await writeJson(join(baseDir, "cache-summary.json"), artifact.cacheSummary);
  }
  await writeJson(join(baseDir, "trace.json"), artifact.trace);
  return artifactPath;
}

export async function persistScenarioArtifacts(
  resultsRoot: string,
  runId: string,
  modelId: string,
  run: ScenarioRunResult
): Promise<DiagnosisArtifacts> {
  const baseDir = join(
    runDirectory(resultsRoot, runId),
    "artifacts",
    safePathSegment(modelId),
    `${safePathSegment(run.scenarioId)}__trial_${run.trial}`
  );
  await ensureDir(baseDir);

  const artifacts: DiagnosisArtifacts = {};
  if (run.screenshotBase64) {
    const screenshotPath = join(baseDir, "screenshot.png");
    await writeFile(screenshotPath, Buffer.from(run.screenshotBase64, "base64"));
    artifacts.screenshotPath = screenshotPath;
  }
  if (run.domSnapshot) {
    const domSnapshotPath = join(baseDir, "dom.html");
    await writeText(domSnapshotPath, run.domSnapshot);
    artifacts.domSnapshotPath = domSnapshotPath;
  }
  const tracePath = join(baseDir, "trace.json");
  await writeJson(tracePath, run.trace);
  artifacts.tracePath = tracePath;
  await writeJson(join(baseDir, "step-runs.json"), run.stepRuns);
  return artifacts;
}

export async function persistRunExplorationArtifacts(
  resultsRoot: string,
  runId: string,
  artifact: ExplorationArtifact
): Promise<string> {
  const baseDir = join(
    runDirectory(resultsRoot, runId),
    "exploration",
    safePathSegment(artifact.modelId),
    `trial_${artifact.trial}`
  );
  return persistExplorationFiles(baseDir, artifact);
}
