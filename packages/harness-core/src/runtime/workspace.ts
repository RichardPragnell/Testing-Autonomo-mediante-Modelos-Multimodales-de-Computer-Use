import { dirname, join } from "node:path";
import type { ResolvedBenchmarkSuite, RunWorkspace } from "../types.js";
import { leaseAvailablePort } from "./ports.js";
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
    autBaseUrl: string;
    autHost: string;
    autPort: string;
  }
): string {
  return value
    .replaceAll("{{repoRoot}}", context.repoRoot.replaceAll("\\", "/"))
    .replaceAll("{{workspacePath}}", context.workspacePath.replaceAll("\\", "/"))
    .replaceAll("{{autBaseUrl}}", context.autBaseUrl)
    .replaceAll("{{autHost}}", context.autHost)
    .replaceAll("{{autPort}}", context.autPort);
}

function formatAutUrl(baseUrl: string, port: number): string {
  const parsed = new URL(baseUrl);
  parsed.port = String(port);
  const formatted = parsed.toString();
  if (!baseUrl.endsWith("/") && parsed.pathname === "/" && !parsed.search && !parsed.hash) {
    return formatted.replace(/\/$/u, "");
  }
  return formatted;
}

async function resolveAutTemplateContext(input: {
  repoRoot: string;
  workspacePath: string;
  baseUrl: string;
}): Promise<{
  repoRoot: string;
  workspacePath: string;
  autBaseUrl: string;
  autHost: string;
  autPort: string;
  releasePort: () => void;
}> {
  const parsed = new URL(input.baseUrl);
  const preferredPort =
    parsed.port.length > 0 ? Number.parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  const lease = await leaseAvailablePort(parsed.hostname, preferredPort);
  return {
    repoRoot: input.repoRoot,
    workspacePath: input.workspacePath,
    autBaseUrl: formatAutUrl(input.baseUrl, lease.port),
    autHost: parsed.hostname,
    autPort: String(lease.port),
    releasePort: lease.release
  };
}

export async function prepareRunWorkspace(input: {
  resolvedSuite: ResolvedBenchmarkSuite;
  runId: string;
  resultsRoot: string;
}): Promise<RunWorkspace> {
  const runRoot = join(input.resultsRoot, "runs", input.runId);
  const workspacePath = join(runRoot, "workspace");
  const repoRoot = dirname(await resolveWorkspacePath("pnpm-workspace.yaml"));
  const templateContext = await resolveAutTemplateContext({
    repoRoot,
    workspacePath,
    baseUrl: input.resolvedSuite.target.target.baseUrl
  });

  await removeDir(workspacePath);
  await ensureDir(runRoot);
  await copyDir(input.resolvedSuite.target.templatePath, workspacePath, {
    excludeNames: ["node_modules"]
  });

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
      url: templateContext.autBaseUrl,
      command: resolveTemplateValue(input.resolvedSuite.target.target.devCommand, templateContext),
      cwd: workspacePath,
      env: Object.fromEntries(
        Object.entries(input.resolvedSuite.target.target.devEnv ?? {}).map(([key, value]) => [
          key,
          resolveTemplateValue(value, templateContext)
        ])
      ),
      releasePort: templateContext.releasePort
    },
    baselineCommit,
    bugCommit
  };
}
