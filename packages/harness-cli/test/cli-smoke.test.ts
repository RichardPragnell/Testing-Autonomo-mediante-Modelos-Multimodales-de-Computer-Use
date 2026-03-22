import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(process.cwd());
const requireFromTest = createRequire(import.meta.url);
const tsxCli = requireFromTest.resolve("tsx/cli");
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function writeRegistry(dir: string, models: string[]): Promise<string> {
  const path = join(dir, "registry.yaml");
  const lines = ["default_model: " + models[0], "models:"];
  for (const modelId of models) {
    lines.push(`  - id: ${modelId}`);
    lines.push(`    provider: ${modelId.split("/")[0]}`);
    lines.push("    enabled: true");
  }
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

function parseTrailingJson(stdout: string): any {
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] !== "{") {
      continue;
    }
    const candidate = stdout.slice(index).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  throw new Error(`no JSON object found in stdout:\n${stdout}`);
}

describe("CLI smoke", () => {
  it(
    "runs and reports the QA benchmark via the new CLI surface",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "cli-qa-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["google/gemini-2.5-flash"]);

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          tsxCli,
          "src/index.ts",
          "qa",
          "run",
          "--app",
          "todo-react",
          "--models-path",
          modelsPath,
          "--results-dir",
          dir
        ],
        {
          cwd: cliDir,
          env: { ...process.env, BENCH_USE_MOCK_RUNNER: "1", BENCH_MOCK_SEED: "11" }
        }
      );
      const run = parseTrailingJson(stdout) as { runId: string };
      expect(run.runId).toContain("qa-todo-react-");

      const report = await execFileAsync(
        process.execPath,
        [tsxCli, "src/index.ts", "qa", "report", "--run-id", run.runId, "--results-dir", dir],
        {
          cwd: cliDir
        }
      );
      expect(report.stdout).toContain("\"kind\": \"qa\"");
    },
    60_000
  );

  it(
    "runs compare flows for exploration and self-heal",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "cli-exp-"));
      tempDirs.push(dir);
      const modelsPath = await writeRegistry(dir, ["openai/gpt-4o-mini"]);

      const exploreA = parseTrailingJson(
        (
          await execFileAsync(
            process.execPath,
            [
              tsxCli,
              "src/index.ts",
              "explore",
              "run",
              "--app",
              "todo-react",
              "--models-path",
              modelsPath,
              "--results-dir",
              dir
            ],
            {
              cwd: cliDir,
              env: { ...process.env, BENCH_USE_MOCK_RUNNER: "1", BENCH_MOCK_SEED: "17" }
            }
          )
        ).stdout
      ) as { runId: string };
      const exploreB = parseTrailingJson(
        (
          await execFileAsync(
            process.execPath,
            [
              tsxCli,
              "src/index.ts",
              "explore",
              "run",
              "--app",
              "todo-react",
              "--models-path",
              modelsPath,
              "--results-dir",
              dir
            ],
            {
              cwd: cliDir,
              env: { ...process.env, BENCH_USE_MOCK_RUNNER: "1", BENCH_MOCK_SEED: "19" }
            }
          )
        ).stdout
      ) as { runId: string };

      const compareExplore = await execFileAsync(
        process.execPath,
        [
          tsxCli,
          "src/index.ts",
          "explore",
          "compare",
          "--run-ids",
          exploreA.runId,
          exploreB.runId,
          "--results-dir",
          dir
        ],
        { cwd: cliDir }
      );
      expect(compareExplore.stdout).toContain("\"aggregateLeaderboard\"");

      const heal = parseTrailingJson(
        (
          await execFileAsync(
            process.execPath,
            [
              tsxCli,
              "src/index.ts",
              "heal",
              "run",
              "--app",
              "todo-react",
              "--models-path",
              modelsPath,
              "--results-dir",
              dir
            ],
            {
              cwd: cliDir,
              env: {
                ...process.env,
                BENCH_USE_MOCK_RUNNER: "1",
                BENCH_USE_MOCK_REPAIR_MODEL: "1",
                BENCH_MOCK_SEED: "23"
              }
            }
          )
        ).stdout
      ) as { runId: string };

      const reportHeal = await execFileAsync(
        process.execPath,
        [tsxCli, "src/index.ts", "heal", "report", "--run-id", heal.runId, "--results-dir", dir],
        { cwd: cliDir }
      );
      expect(reportHeal.stdout).toContain("\"kind\": \"heal\"");
    },
    60_000
  );
});
