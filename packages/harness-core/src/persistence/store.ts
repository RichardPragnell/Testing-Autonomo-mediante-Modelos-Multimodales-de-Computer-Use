import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import type {
  BenchmarkReport,
  DiagnosisArtifacts,
  RepairAttempt,
  RunArtifact,
  TaskRunResult
} from "../types.js";

export function runDirectory(resultsRoot: string, runId: string): string {
  return join(resultsRoot, "runs", runId);
}

export async function persistTaskArtifacts(
  resultsRoot: string,
  runId: string,
  modelId: string,
  run: TaskRunResult
): Promise<DiagnosisArtifacts> {
  const baseDir = join(runDirectory(resultsRoot, runId), "artifacts", modelId, `${run.taskId}__trial_${run.trial}`);
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
  return artifacts;
}

export async function persistRunArtifact(resultsRoot: string, artifact: RunArtifact): Promise<string> {
  const runDir = runDirectory(resultsRoot, artifact.runId);
  await ensureDir(runDir);
  const artifactPath = join(runDir, "run.json");
  await writeJson(artifactPath, artifact);
  return artifactPath;
}

export async function persistRunManifest(resultsRoot: string, artifact: RunArtifact): Promise<string> {
  const manifestPath = join(runDirectory(resultsRoot, artifact.runId), "manifest.json");
  await writeJson(manifestPath, {
    runId: artifact.runId,
    suiteId: artifact.suiteId,
    targetId: artifact.targetId,
    scenarioIds: artifact.scenarioIds,
    bugIds: artifact.bugIds,
    explorationMode: artifact.explorationMode,
    workspacePath: artifact.workspacePath,
    startedAt: artifact.startedAt,
    finishedAt: artifact.finishedAt
  });
  return manifestPath;
}

export async function readRunArtifact(resultsRoot: string, runId: string): Promise<RunArtifact> {
  const raw = await readFile(join(runDirectory(resultsRoot, runId), "run.json"), "utf8");
  return JSON.parse(raw) as RunArtifact;
}

export async function persistReport(resultsRoot: string, report: BenchmarkReport): Promise<string> {
  const reportsDir = join(resultsRoot, "reports");
  await ensureDir(reportsDir);
  const reportPath = join(reportsDir, `${report.runId}.json`);
  await writeJson(reportPath, report);
  return reportPath;
}

export async function readReport(resultsRoot: string, runId: string): Promise<BenchmarkReport> {
  const raw = await readFile(join(resultsRoot, "reports", `${runId}.json`), "utf8");
  return JSON.parse(raw) as BenchmarkReport;
}

export async function persistRepairAttempt(
  resultsRoot: string,
  runId: string,
  attempt: RepairAttempt
): Promise<string> {
  const repairDir = join(runDirectory(resultsRoot, runId), "repairs");
  await ensureDir(repairDir);
  const path = join(repairDir, `${attempt.attemptId}.json`);
  await writeJson(path, attempt);
  return path;
}
