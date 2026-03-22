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
  it("shows only the three run commands at the top level", async () => {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "--help"], {
      cwd: cliDir
    });

    expect(stdout).toContain("qa");
    expect(stdout).toContain("explore");
    expect(stdout).toContain("heal");
    expect(stdout).not.toContain("report");
    expect(stdout).not.toContain("compare");
  });

  it("requires a positional app argument and does not expose the removed flags", async () => {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "qa", "--help"], {
      cwd: cliDir
    });

    expect(stdout).toContain("qa [options] <app>");
    expect(stdout).not.toContain("--app");
    expect(stdout).not.toContain("--models");
    expect(stdout).not.toContain("--models-path");
    expect(stdout).not.toContain("--trials");
    expect(stdout).not.toContain("--results-dir");
    expect(stdout).not.toContain("--preset");
  });
});
