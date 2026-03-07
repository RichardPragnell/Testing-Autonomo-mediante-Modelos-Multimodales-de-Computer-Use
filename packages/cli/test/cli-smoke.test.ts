import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(process.cwd());
const requireFromTest = createRequire(import.meta.url);
const tsxCli = requireFromTest.resolve("tsx/cli");

describe("CLI smoke", () => {
  it(
    "runs plan status",
    async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [tsxCli, "src/index.ts", "plan", "status"],
        {
          cwd: cliDir
        }
      );
      expect(stdout).toContain("\"steps\"");
      expect(stdout).toContain("\"P0\"");
    },
    60_000
  );

  it(
    "runs plan next",
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "plan", "next"], {
        cwd: cliDir
      });
      expect(stdout.toLowerCase()).toContain("undefined");
    },
    60_000
  );
});
