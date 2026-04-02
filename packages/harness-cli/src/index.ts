#!/usr/bin/env node
import { Command } from "commander";
import {
  loadProjectEnv,
  rebuildBenchmarkReports,
  runExploreAcrossApps,
  runExploreExperiment,
  runHealAcrossApps,
  runHealExperiment,
  runQaAcrossApps,
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

function printSingleRun(result: {
  artifact: {
    runId: string;
  };
  artifactPath: string;
  reportPath: string;
  htmlPath: string;
}): void {
  print({
    runId: result.artifact.runId,
    artifactPath: result.artifactPath,
    reportPath: result.reportPath,
    htmlPath: result.htmlPath
  });
}

function printMultiRun(result: {
  mode: string;
  appIds: string[];
  runs: Array<{
    appId: string;
    runId: string;
    artifactPath: string;
    reportPath: string;
    htmlPath: string;
  }>;
  finalReportPath: string;
  finalJsonPath: string;
}): void {
  print({
    mode: result.mode,
    appIds: result.appIds,
    runs: result.runs,
    finalReportPath: result.finalReportPath,
    finalJsonPath: result.finalJsonPath
  });
}

function printReportRebuild(result: {
  selectionPolicy: string;
  selectedReports: Array<{
    kind: string;
    appId: string;
    runId: string;
    generatedAt: string;
    reportPath: string;
  }>;
  modeReports: Array<{
    kind: string;
    appIds: string[];
    runIds: string[];
    finalReportPath: string;
    finalJsonPath: string;
  }>;
  finalReportPath?: string;
  finalJsonPath?: string;
}): void {
  print({
    selectionPolicy: result.selectionPolicy,
    selectedReports: result.selectedReports,
    rebuiltReports: result.modeReports,
    finalReportPath: result.finalReportPath,
    finalJsonPath: result.finalJsonPath
  });
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
    .name("agentic-qa")
    .description("Production benchmark CLI for QA, exploration, self-healing, and report rebuilds")
    .showHelpAfterError();

  program
    .command("qa")
    .description("Run the guided QA benchmark; omit app to run all benchmark apps")
    .option("--profile <profile>", "QA runtime profile (fast or full)", "fast")
    .option("--models <ids...>", "Explicit OpenRouter model IDs to run")
    .option("--trials <n>", "Override trial count", parsePositiveInt)
    .option("--max-steps <n>", "Override guided step budget", parsePositiveInt)
    .option("--timeout-ms <n>", "Override per-task timeout in milliseconds", parsePositiveInt)
    .option("--max-output-tokens <n>", "Cap output tokens per model call", parsePositiveInt)
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined, options: {
      profile: "fast" | "full";
      models?: string[];
      trials?: number;
      maxSteps?: number;
      timeoutMs?: number;
      maxOutputTokens?: number;
    }) => {
      if (app) {
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
        printSingleRun(result);
        return;
      }

      const result = await runQaAcrossApps({
        profile: options.profile,
        models: options.models,
        trials: options.trials,
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxOutputTokens: options.maxOutputTokens,
        onLog
      });
      printMultiRun(result);
    });

  program
    .command("explore")
    .description("Run the autonomous exploration benchmark; omit app to run all benchmark apps")
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined) => {
      if (app) {
        const result = await runExploreExperiment({
          appId: app,
          onLog
        });
        printSingleRun(result);
        return;
      }

      const result = await runExploreAcrossApps({
        onLog
      });
      printMultiRun(result);
    });

  program
    .command("heal")
    .description("Run the self-healing benchmark; omit app to run all benchmark apps")
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined) => {
      if (app) {
        const result = await runHealExperiment({
          appId: app,
          onLog
        });
        printSingleRun(result);
        return;
      }

      const result = await runHealAcrossApps({
        onLog
      });
      printMultiRun(result);
    });

  program
    .command("report")
    .description("Rebuild comparison reports from saved benchmark report JSON files")
    .argument("[mode]", "Benchmark mode to rebuild (qa, explore, or heal)")
    .action(async (mode: string | undefined) => {
      if (mode && mode !== "qa" && mode !== "explore" && mode !== "heal") {
        throw new Error(`unsupported report mode ${mode}`);
      }
      const reportMode = mode as "qa" | "explore" | "heal" | undefined;

      const result = await rebuildBenchmarkReports({
        mode: reportMode
      });
      printReportRebuild(result);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`benchmark command failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
