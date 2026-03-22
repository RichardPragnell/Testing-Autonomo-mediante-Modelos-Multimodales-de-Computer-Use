import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AutConfig } from "../types.js";
import { execCommand } from "../utils/exec.js";

export interface WorktreeRepairResult {
  outcome: "fixed" | "not_fixed" | "regression" | "skipped";
  note: string;
  patchPath?: string;
  validationExitCode?: number;
}

function createWorktreeToken(attemptId: string): string {
  return createHash("sha1").update(attemptId).digest("hex").slice(0, 10);
}

async function hasGitRepo(cwd: string): Promise<boolean> {
  const result = await execCommand("git rev-parse --is-inside-work-tree", { cwd });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export function rebaseAutConfig(aut: AutConfig, fromPath: string, toPath: string): AutConfig {
  const from = fromPath.replaceAll("\\", "/");
  const to = toPath.replaceAll("\\", "/");
  const replaceValue = (value: string) => value.replaceAll(value.includes("\\") ? fromPath : from, value.includes("\\") ? toPath : to);

  return {
    ...aut,
    cwd: aut.cwd ? replaceValue(aut.cwd) : toPath,
    command: aut.command ? replaceValue(aut.command) : aut.command,
    env: Object.fromEntries(
      Object.entries(aut.env ?? {}).map(([key, value]) => [key, replaceValue(value)])
    )
  };
}

export async function withPatchedIsolatedWorktree<T>(input: {
  cwd: string;
  patch: string;
  attemptId: string;
  run: (context: { worktreePath: string; patchPath: string }) => Promise<T>;
}): Promise<
  | {
      ok: true;
      patchPath: string;
      result: T;
    }
  | {
      ok: false;
      repair: WorktreeRepairResult;
    }
> {
  if (!(await hasGitRepo(input.cwd))) {
    return {
      ok: false,
      repair: {
        outcome: "skipped",
        note: "self-healing requires a git repository for isolated worktree execution"
      }
    };
  }

  const token = createWorktreeToken(input.attemptId);
  const branchName = `heal-${token}`;
  const tempRoot = await mkdtemp(join(tmpdir(), `bench-heal-${token}-`));
  const worktreePath = join(tempRoot, "wt");
  const patchPath = join(worktreePath, "repair.patch");

  await mkdir(tempRoot, { recursive: true });
  const addResult = await execCommand(`git -c core.longpaths=true worktree add -b ${branchName} "${worktreePath}" HEAD`, {
    cwd: input.cwd
  });
  if (addResult.exitCode !== 0) {
    await rm(tempRoot, { recursive: true, force: true });
    return {
      ok: false,
      repair: {
        outcome: "regression",
        note: `failed to create worktree: ${addResult.stderr || addResult.stdout}`
      }
    };
  }

  try {
    await writeFile(patchPath, input.patch, "utf8");
    const applyResult = await execCommand(`git apply "${patchPath}"`, {
      cwd: worktreePath
    });
    if (applyResult.exitCode !== 0) {
      return {
        ok: false,
        repair: {
          outcome: "regression",
          note: `failed to apply patch: ${applyResult.stderr || applyResult.stdout}`,
          patchPath
        }
      };
    }

    return {
      ok: true,
      patchPath,
      result: await input.run({ worktreePath, patchPath })
    };
  } finally {
    await execCommand(`git worktree remove --force "${worktreePath}"`, {
      cwd: input.cwd
    });
    await execCommand(`git branch -D ${branchName}`, { cwd: input.cwd });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function applyPatchInIsolatedWorktree(input: {
  cwd: string;
  patch: string;
  validationCommand: string;
  attemptId: string;
}): Promise<WorktreeRepairResult> {
  const result = await withPatchedIsolatedWorktree({
    cwd: input.cwd,
    patch: input.patch,
    attemptId: input.attemptId,
    run: async ({ worktreePath, patchPath }) => {
      const validateResult = await execCommand(input.validationCommand, { cwd: worktreePath });
      if (validateResult.exitCode === 0) {
        return {
          outcome: "fixed",
          note: "validation succeeded in isolated worktree",
          patchPath,
          validationExitCode: 0
        } satisfies WorktreeRepairResult;
      }
      return {
        outcome: "not_fixed",
        note: `validation failed: ${validateResult.stderr || validateResult.stdout}`,
        patchPath,
        validationExitCode: validateResult.exitCode
      } satisfies WorktreeRepairResult;
    }
  });

  return result.ok ? result.result : result.repair;
}
