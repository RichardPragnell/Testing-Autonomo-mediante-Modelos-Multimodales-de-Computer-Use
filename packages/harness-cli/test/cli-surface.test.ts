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

      expect(stdout).toContain("guided");
      expect(stdout).toContain("explore");
      expect(stdout).toContain("heal");
      expect(stdout).toContain("fullbench");
      expect(stdout).toContain("report");
      expect(stdout).not.toContain("suite");
      expect(stdout).not.toContain("compare");
    },
    15_000
  );

  it(
    "uses optional app arguments for guided, explore, and heal and exposes report rebuild help",
    async () => {
      const [
        { stdout: guidedHelp },
        { stdout: exploreHelp },
        { stdout: healHelp },
        { stdout: fullbenchHelp },
        { stdout: reportHelp }
      ] = await Promise.all([
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "guided", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "explore", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "heal", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "fullbench", "--help"], {
          cwd: cliDir
        }),
        execFileAsync(process.execPath, [tsxCli, "src/index.ts", "report", "--help"], {
          cwd: cliDir
        })
      ]);

      expect(guidedHelp).toContain("guided [options] [app]");
      expect(guidedHelp).toContain("--models <ids...>");
      expect(guidedHelp).toContain("--trials <n>");
      expect(guidedHelp).toContain("--parallelism <n>");
      expect(guidedHelp).toContain("--app-parallelism <n>");
      expect(guidedHelp).toContain("--max-steps <n>");
      expect(guidedHelp).toContain("--timeout-ms <n>");
      expect(guidedHelp).toContain("--max-output-tokens <n>");
      expect(guidedHelp).not.toContain("--profile <profile>");
      expect(guidedHelp).not.toContain("--app <");
      expect(guidedHelp).not.toContain("--models-path");
      expect(guidedHelp).not.toContain("--results-dir");
      expect(guidedHelp).not.toContain("--preset");

      expect(exploreHelp).toContain("explore [options] [app]");
      expect(exploreHelp).toContain("--parallelism <n>");
      expect(exploreHelp).toContain("--app-parallelism <n>");
      expect(healHelp).toContain("heal [options] [app]");
      expect(healHelp).toContain("--parallelism <n>");
      expect(healHelp).toContain("--app-parallelism <n>");
      expect(fullbenchHelp).toContain("fullbench [options]");
      expect(fullbenchHelp).toContain("--parallel <n>");
      expect(fullbenchHelp).toContain("--parallelism <n>");
      expect(fullbenchHelp).toContain("--app-parallelism <n>");
      expect(fullbenchHelp).toContain("--html-scope <scope>");
      expect(fullbenchHelp).toContain("--skip-existing");
      expect(reportHelp).toContain("report [options] [mode]");
      expect(reportHelp).toContain("guided, explore, or heal");
      expect(reportHelp).toContain("--html-scope <scope>");
      expect(reportHelp).toContain("compare (default) or all");
    },
    15_000
  );
});
