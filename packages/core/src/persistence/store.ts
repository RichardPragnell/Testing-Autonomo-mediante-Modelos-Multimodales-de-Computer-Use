import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import type {
  DiagnosisArtifacts,
  ExperimentReport,
  RepairAttempt,
  RunArtifact,
  TaskRunResult
} from "../types.js";

export function runDirectory(outputDir: string, runId: string): string {
  return join(outputDir, runId);
}

export async function persistTaskArtifacts(
  outputDir: string,
  runId: string,
  modelId: string,
  run: TaskRunResult
): Promise<DiagnosisArtifacts> {
  const baseDir = join(outputDir, runId, "artifacts", modelId, `${run.taskId}__trial_${run.trial}`);
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

export async function persistRunArtifact(
  outputDir: string,
  artifact: RunArtifact
): Promise<string> {
  const runDir = runDirectory(outputDir, artifact.runId);
  await ensureDir(runDir);
  const artifactPath = join(runDir, "run.json");
  await writeJson(artifactPath, artifact);
  return artifactPath;
}

export async function readRunArtifact(outputDir: string, runId: string): Promise<RunArtifact> {
  const raw = await readFile(join(outputDir, runId, "run.json"), "utf8");
  return JSON.parse(raw) as RunArtifact;
}

export async function persistReport(
  reportsDir: string,
  report: ExperimentReport
): Promise<string> {
  await ensureDir(reportsDir);
  const reportPath = join(reportsDir, `${report.runId}.json`);
  await writeJson(reportPath, report);
  return reportPath;
}

export async function readReport(reportsDir: string, runId: string): Promise<ExperimentReport> {
  const raw = await readFile(join(reportsDir, `${runId}.json`), "utf8");
  return JSON.parse(raw) as ExperimentReport;
}

export async function persistRepairAttempt(
  outputDir: string,
  runId: string,
  attempt: RepairAttempt
): Promise<string> {
  const repairDir = join(outputDir, runId, "repairs");
  await ensureDir(repairDir);
  const path = join(repairDir, `${attempt.attemptId}.json`);
  await writeJson(path, attempt);
  return path;
}
