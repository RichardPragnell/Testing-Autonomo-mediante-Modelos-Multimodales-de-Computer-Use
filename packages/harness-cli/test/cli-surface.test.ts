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
    "shows the benchmark mode commands plus report rebuild at the top level",
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "--help"], {
        cwd: cliDir
      });

      expect(stdout).toContain("qa");
      expect(stdout).toContain("explore");
      expect(stdout).toContain("heal");
      expect(stdout).toContain("report");
      expect(stdout).not.toContain("suite");
      expect(stdout).not.toContain("compare");
    },
    15_000
  );

  it(
    "uses optional app arguments for qa, explore, and heal and exposes report rebuild help",
    async () => {
      const [{ stdout: qaHelp }, { stdout: exploreHelp }, { stdout: healHelp }, { stdout: reportHelp }] = await Promise.all([
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "qa", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "explore", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "heal", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "report", "--help"], {
          cwd: cliDir
        })
      ]);

      expect(qaHelp).toContain("qa [options] [app]");
      expect(qaHelp).toContain("--profile <profile>");
      expect(qaHelp).toContain("--models <ids...>");
      expect(qaHelp).toContain("--trials <n>");
      expect(qaHelp).toContain("--max-steps <n>");
      expect(qaHelp).toContain("--timeout-ms <n>");
      expect(qaHelp).toContain("--max-output-tokens <n>");
      expect(qaHelp).not.toContain("--app");
      expect(qaHelp).not.toContain("--models-path");
      expect(qaHelp).not.toContain("--results-dir");
      expect(qaHelp).not.toContain("--preset");

      expect(exploreHelp).toContain("explore [options] [app]");
      expect(healHelp).toContain("heal [options] [app]");
      expect(reportHelp).toContain("report [options] [mode]");
      expect(reportHelp).toContain("qa, explore, or heal");
    },
    15_000
  );
});
