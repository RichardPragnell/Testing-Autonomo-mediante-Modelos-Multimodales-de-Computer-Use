import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(process.cwd());
const requireFromTest = createRequire(import.meta.url);
const tsxCli = requireFromTest.resolve("tsx/cli");

describe("CLI surface", () => {
  it(
    "shows run, suite, and compare commands at the top level",
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "--help"], {
        cwd: cliDir
      });

      expect(stdout).toContain("qa");
    expect(stdout).toContain("explore");
      expect(stdout).toContain("heal");
      expect(stdout).toContain("suite");
      expect(stdout).toContain("compare");
      expect(stdout).not.toContain("report [command]");
    },
    15_000
  );

  it("requires a positional app argument and does not expose the removed flags", async () => {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "qa", "--help"], {
      cwd: cliDir
    });

    expect(stdout).toContain("qa [options] <app>");
    expect(stdout).toContain("--profile <profile>");
    expect(stdout).toContain("--models <ids...>");
    expect(stdout).toContain("--trials <n>");
    expect(stdout).toContain("--max-steps <n>");
    expect(stdout).toContain("--timeout-ms <n>");
    expect(stdout).toContain("--max-output-tokens <n>");
    expect(stdout).not.toContain("--app");
    expect(stdout).not.toContain("--models-path");
    expect(stdout).not.toContain("--results-dir");
    expect(stdout).not.toContain("--preset");
  });
});
