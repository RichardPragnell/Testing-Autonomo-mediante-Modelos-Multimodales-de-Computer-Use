import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { execCommand } from "../../src/utils/exec.js";
import { withPatchedIsolatedWorktree } from "../../src/self-heal/worktree.js";

const tempDirs: string[] = [];

async function expectCommandSuccess(command: string, cwd: string): Promise<void> {
  const result = await execCommand(command, { cwd });
  expect(result.exitCode).toBe(0);
}

describe("self-heal worktree cleanup", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("does not delete the target of a worktree node_modules junction during cleanup", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "self-heal-worktree-"));
    tempDirs.push(dir);
    const repoPath = join(dir, "repo");
    const sharedModulesPath = join(dir, "shared-node_modules");
    await mkdir(repoPath, { recursive: true });
    await mkdir(sharedModulesPath, { recursive: true });
    await writeFile(join(sharedModulesPath, "sentinel.txt"), "ok", "utf8");
    await writeFile(join(repoPath, "file.txt"), "before\n", "utf8");

    await expectCommandSuccess("git init", repoPath);
    await expectCommandSuccess('git config user.email "bench@local.invalid"', repoPath);
    await expectCommandSuccess('git config user.name "Benchmark Harness"', repoPath);
    await expectCommandSuccess("git add -A", repoPath);
    await expectCommandSuccess('git commit -m "Initial"', repoPath);

    const patch = ["--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "-before", "+after", ""].join("\n");

    const result = await withPatchedIsolatedWorktree({
      cwd: repoPath,
      patch,
      attemptId: "preserve-junction-target",
      run: async ({ worktreePath }) => {
        const junctionPath = join(worktreePath, "node_modules");
        const createJunction = await execCommand(
          `powershell -NoProfile -Command "New-Item -ItemType Junction -Path '${junctionPath.replaceAll("\\", "/")}' -Target '${sharedModulesPath.replaceAll("\\", "/")}' | Out-Null"`,
          { cwd: worktreePath }
        );
        expect(createJunction.exitCode).toBe(0);
        return {
          worktreePath
        };
      }
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(sharedModulesPath, "sentinel.txt"), "utf8")).toBe("ok");
  });
});
