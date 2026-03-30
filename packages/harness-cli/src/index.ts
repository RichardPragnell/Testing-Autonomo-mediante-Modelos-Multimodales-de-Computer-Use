#!/usr/bin/env node
import { Command } from "commander";
import {
  compareBenchmarkRuns,
  loadProjectEnv,
  runBenchmarkSuite,
  runExploreExperiment,
  runHealExperiment,
  runQaExperiment
} from "@agentic-qa/harness-core";

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${value}`);
  }
  return parsed;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function createProgressLogger(): ((message: string) => void) | undefined {
  if (!process.stderr.isTTY) {
    return undefined;
  }

  return (message: string) => {
    process.stderr.write(`${message}\n`);
  };
}

async function main(): Promise<void> {
  await loadProjectEnv();
  const onLog = createProgressLogger();

  const program = new Command();
  program
    .name("bench")
    .description("Production benchmark CLI for QA, exploration, and self-healing")
    .showHelpAfterError();

  program
    .command("qa")
    .description("Run the guided QA benchmark")
    .option("--profile <profile>", "QA runtime profile (fast or full)", "fast")
    .option("--models <ids...>", "Explicit OpenRouter model IDs to run")
    .option("--trials <n>", "Override trial count", parsePositiveInt)
    .option("--max-steps <n>", "Override guided step budget", parsePositiveInt)
    .option("--timeout-ms <n>", "Override per-task timeout in milliseconds", parsePositiveInt)
    .option("--max-output-tokens <n>", "Cap output tokens per model call", parsePositiveInt)
    .argument("<app>", "Benchmark app identifier")
    .action(async (app: string, options: {
      profile: "fast" | "full";
      models?: string[];
      trials?: number;
      maxSteps?: number;
      timeoutMs?: number;
      maxOutputTokens?: number;
    }) => {
      const result = await runQaExperiment({
        appId: app,
        profile: options.profile,
        models: options.models,
        trials: options.trials,
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxOutputTokens: options.maxOutputTokens,
        onLog
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    });

  program
    .command("explore")
    .description("Run the autonomous exploration benchmark")
    .argument("<app>", "Benchmark app identifier")
    .action(async (app: string) => {
      const result = await runExploreExperiment({
        appId: app,
        onLog
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    });

  program
    .command("heal")
    .description("Run the self-healing benchmark")
    .argument("<app>", "Benchmark app identifier")
    .action(async (app: string) => {
      const result = await runHealExperiment({
        appId: app,
        onLog
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    });

  program
    .command("suite")
    .description("Run all benchmark modes for an app and generate the final matrix report")
    .argument("<app>", "Benchmark app identifier")
    .action(async (app: string) => {
      const result = await runBenchmarkSuite({
        suitePath: `apps/${app}/benchmark.json`,
        onLog
      });
      print({
        appId: result.appId,
        qa: result.qa,
        explore: result.explore,
        heal: result.heal,
        finalReportPath: result.finalReportPath,
        finalJsonPath: result.finalJsonPath
      });
    });

  program
    .command("compare")
    .description("Generate the final matrix report from existing benchmark run IDs")
    .argument("<runIds...>", "Benchmark run identifiers to compare")
    .action(async (runIds: string[]) => {
      onLog?.(`[compare] Comparing ${runIds.length} run(s)`);
      const result = await compareBenchmarkRuns(runIds);
      onLog?.(`[compare] Completed. Final report: ${result.finalReportPath}`);
      print({
        runIds: result.runIds,
        appIds: result.appIds,
        modeCount: result.modeSections.length,
        finalReportPath: result.finalReportPath,
        finalJsonPath: result.finalJsonPath
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`bench failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
