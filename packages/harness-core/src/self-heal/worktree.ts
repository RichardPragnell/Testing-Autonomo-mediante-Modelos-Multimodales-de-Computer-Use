import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execCommand } from "../utils/exec.js";

export interface WorktreeRepairResult {
  outcome: "fixed" | "not_fixed" | "regression" | "skipped";
  note: string;
  patchPath?: string;
  validationExitCode?: number;
}

async function hasGitRepo(cwd: string): Promise<boolean> {
  const result = await execCommand("git rev-parse --is-inside-work-tree", { cwd });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export async function applyPatchInIsolatedWorktree(input: {
  cwd: string;
  patch: string;
  validationCommand: string;
  attemptId: string;
}): Promise<WorktreeRepairResult> {
  if (!(await hasGitRepo(input.cwd))) {
    return {
      outcome: "skipped",
      note: "self-healing requires a git repository for isolated worktree execution"
    };
  }

  const worktreeRoot = join(input.cwd, ".tmp", "worktrees");
  const branchName = `heal/${input.attemptId}`;
  const worktreePath = join(worktreeRoot, input.attemptId);
  const patchPath = join(worktreePath, "repair.patch");

  await mkdir(worktreeRoot, { recursive: true });
  const addResult = await execCommand(`git worktree add -b ${branchName} "${worktreePath}" HEAD`, {
    cwd: input.cwd
  });
  if (addResult.exitCode !== 0) {
    return {
      outcome: "regression",
      note: `failed to create worktree: ${addResult.stderr || addResult.stdout}`
    };
  }

  try {
    await writeFile(patchPath, input.patch, "utf8");
    const applyResult = await execCommand(`git apply "${patchPath}"`, {
      cwd: worktreePath
    });
    if (applyResult.exitCode !== 0) {
      return {
        outcome: "regression",
        note: `failed to apply patch: ${applyResult.stderr || applyResult.stdout}`,
        patchPath
      };
    }

    const validateResult = await execCommand(input.validationCommand, { cwd: worktreePath });
    if (validateResult.exitCode === 0) {
      return {
        outcome: "fixed",
        note: "validation succeeded in isolated worktree",
        patchPath,
        validationExitCode: 0
      };
    }
    return {
      outcome: "not_fixed",
      note: `validation failed: ${validateResult.stderr || validateResult.stdout}`,
      patchPath,
      validationExitCode: validateResult.exitCode
    };
  } finally {
    await execCommand(`git worktree remove --force "${worktreePath}"`, {
      cwd: input.cwd
    });
    await execCommand(`git branch -D ${branchName}`, { cwd: input.cwd });
    await rm(worktreePath, { recursive: true, force: true });
  }
}

