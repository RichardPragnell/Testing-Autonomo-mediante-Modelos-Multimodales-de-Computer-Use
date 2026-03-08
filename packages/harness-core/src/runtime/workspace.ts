import { dirname, join } from "node:path";
import type { ResolvedBenchmarkSuite, RunWorkspace } from "../types.js";
import { execCommand } from "../utils/exec.js";
import { copyDir, ensureDir, removeDir, resolveWorkspacePath } from "../utils/fs.js";

async function expectSuccess(command: string, cwd: string, env?: Record<string, string>): Promise<string> {
  const result = await execCommand(command, { cwd, env });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `command failed: ${command}`);
  }
  return result.stdout.trim();
}

function resolveTemplateValue(
  value: string,
  context: {
    repoRoot: string;
    workspacePath: string;
  }
): string {
  return value
    .replaceAll("{{repoRoot}}", context.repoRoot.replaceAll("\\", "/"))
    .replaceAll("{{workspacePath}}", context.workspacePath.replaceAll("\\", "/"));
}

export async function prepareRunWorkspace(input: {
  resolvedSuite: ResolvedBenchmarkSuite;
  runId: string;
  resultsRoot: string;
}): Promise<RunWorkspace> {
  const runRoot = join(input.resultsRoot, "runs", input.runId);
  const workspacePath = join(runRoot, "workspace");
  const repoRoot = dirname(await resolveWorkspacePath("package.json"));
  const templateContext = { repoRoot, workspacePath };

  await removeDir(workspacePath);
  await ensureDir(runRoot);
  await copyDir(input.resolvedSuite.target.templatePath, workspacePath);

  await expectSuccess("git init", workspacePath);
  await expectSuccess('git config user.email "bench@local.invalid"', workspacePath);
  await expectSuccess('git config user.name "Benchmark Harness"', workspacePath);
  await expectSuccess("git add -A", workspacePath);
  await expectSuccess('git commit -m "Baseline target template"', workspacePath);
  const baselineCommit = await expectSuccess("git rev-parse HEAD", workspacePath);

  let bugCommit = baselineCommit;
  if (input.resolvedSuite.selectedBugs.length > 0) {
    for (const bug of input.resolvedSuite.selectedBugs) {
      await expectSuccess(`git apply "${bug.absolutePatchPath}"`, workspacePath);
    }

    await expectSuccess("git add -A", workspacePath);
    await expectSuccess(
      `git commit -m "Apply benchmark bugs: ${input.resolvedSuite.suite.bugIds.join(", ")}"`,
      workspacePath
    );
    bugCommit = await expectSuccess("git rev-parse HEAD", workspacePath);
  }

  return {
    workspacePath,
    templatePath: input.resolvedSuite.target.templatePath,
    targetId: input.resolvedSuite.suite.targetId,
    bugIds: input.resolvedSuite.suite.bugIds,
    validationCommand:
      resolveTemplateValue(
        input.resolvedSuite.selectedBugs.find((bug) => bug.validationCommand)?.validationCommand ??
          input.resolvedSuite.target.target.defaultValidationCommand,
        templateContext
      ),
    aut: {
      url: input.resolvedSuite.target.target.baseUrl,
      command: resolveTemplateValue(input.resolvedSuite.target.target.devCommand, templateContext),
      cwd: workspacePath,
      env: Object.fromEntries(
        Object.entries(input.resolvedSuite.target.target.devEnv ?? {}).map(([key, value]) => [
          key,
          resolveTemplateValue(value, templateContext)
        ])
      )
    },
    baselineCommit,
    bugCommit
  };
}
