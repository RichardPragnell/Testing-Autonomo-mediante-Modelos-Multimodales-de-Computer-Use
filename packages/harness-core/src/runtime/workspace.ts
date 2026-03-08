import { join } from "node:path";
import type { ResolvedBenchmarkSuite, RunWorkspace } from "../types.js";
import { execCommand } from "../utils/exec.js";
import { copyDir, ensureDir, removeDir } from "../utils/fs.js";

async function expectSuccess(command: string, cwd: string, env?: Record<string, string>): Promise<string> {
  const result = await execCommand(command, { cwd, env });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `command failed: ${command}`);
  }
  return result.stdout.trim();
}

export async function prepareRunWorkspace(input: {
  resolvedSuite: ResolvedBenchmarkSuite;
  runId: string;
  resultsRoot: string;
}): Promise<RunWorkspace> {
  const runRoot = join(input.resultsRoot, "runs", input.runId);
  const workspacePath = join(runRoot, "workspace");

  await removeDir(workspacePath);
  await ensureDir(runRoot);
  await copyDir(input.resolvedSuite.target.templatePath, workspacePath);

  await expectSuccess("git init", workspacePath);
  await expectSuccess('git config user.email "bench@local.invalid"', workspacePath);
  await expectSuccess('git config user.name "Benchmark Harness"', workspacePath);
  await expectSuccess("git add -A", workspacePath);
  await expectSuccess('git commit -m "Baseline target template"', workspacePath);
  const baselineCommit = await expectSuccess("git rev-parse HEAD", workspacePath);

  for (const bug of input.resolvedSuite.selectedBugs) {
    await expectSuccess(`git apply "${bug.absolutePatchPath}"`, workspacePath);
  }

  await expectSuccess("git add -A", workspacePath);
  await expectSuccess(
    `git commit -m "Apply benchmark bugs: ${input.resolvedSuite.suite.bugIds.join(", ") || "none"}"`,
    workspacePath
  );
  const bugCommit = await expectSuccess("git rev-parse HEAD", workspacePath);

  return {
    workspacePath,
    templatePath: input.resolvedSuite.target.templatePath,
    targetId: input.resolvedSuite.suite.targetId,
    bugIds: input.resolvedSuite.suite.bugIds,
    validationCommand:
      input.resolvedSuite.selectedBugs.find((bug) => bug.validationCommand)?.validationCommand ??
      input.resolvedSuite.target.target.defaultValidationCommand,
    aut: {
      url: input.resolvedSuite.target.target.baseUrl,
      command: input.resolvedSuite.target.target.devCommand,
      cwd: workspacePath,
      env: input.resolvedSuite.target.target.devEnv
    },
    baselineCommit,
    bugCommit
  };
}
