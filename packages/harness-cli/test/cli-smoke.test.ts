import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(process.cwd());
const requireFromTest = createRequire(import.meta.url);
const tsxCli = requireFromTest.resolve("tsx/cli");

describe("CLI smoke", () => {
  it(
    "lists benchmark targets",
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "list", "targets"], {
        cwd: cliDir
      });
      expect(stdout).toContain("\"targetId\": \"pulse-lab\"");
    },
    60_000
  );

  it(
    "lists benchmark suites",
    async () => {
      const { stdout } = await execFileAsync(process.execPath, [tsxCli, "src/index.ts", "list", "suites"], {
        cwd: cliDir
      });
      expect(stdout).toContain("\"suiteId\": \"pulse-lab-guided-bugged\"");
      expect(stdout).toContain("\"explorationMode\": \"guided\"");
    },
    60_000
  );
});
