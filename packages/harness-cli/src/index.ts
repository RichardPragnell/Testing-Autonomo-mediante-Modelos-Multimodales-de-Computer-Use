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

function toPublicMode(mode: string): string {
  return mode === "qa" ? "guided" : mode;
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
    mode: toPublicMode(result.mode),
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
    modelId: string;
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
    selectedReports: result.selectedReports.map((entry) => ({
      ...entry,
      kind: toPublicMode(entry.kind)
    })),
    rebuiltReports: result.modeReports.map((entry) => ({
      ...entry,
      kind: toPublicMode(entry.kind)
    })),
    finalReportPath: result.finalReportPath,
    finalJsonPath: result.finalJsonPath
  });
}

function normalizeReportMode(mode: string | undefined): "qa" | "explore" | "heal" | undefined {
  if (!mode) {
    return undefined;
  }
  if (mode === "guided") {
    return "qa";
  }
  if (mode === "explore" || mode === "heal") {
    return mode;
  }
  throw new Error(`unsupported report mode ${mode}`);
}

function createProgressLogger(): ((message: string) => void) | undefined {
  if (!process.stderr.isTTY) {
    return undefined;
  }

  return (message: string) => {
    process.stderr.write(`${message}\n`);
  };
}

function registerGuidedCommand(
  program: Command,
  input: {
    name: string;
    hidden?: boolean;
    onLog: ((message: string) => void) | undefined;
  }
): void {
  program
    .command(input.name, input.hidden ? { hidden: true } : {})
    .description("Run the guided benchmark; omit app to run all benchmark apps")
    .option("--models <ids...>", "Explicit OpenRouter model IDs to run")
    .option("--trials <n>", "Override trial count", parsePositiveInt)
    .option("--parallelism <n>", "Run up to this many models in parallel per app", parsePositiveInt)
    .option("--app-parallelism <n>", "Run up to this many apps in parallel for multi-app mode", parsePositiveInt)
    .option("--max-steps <n>", "Override guided step budget", parsePositiveInt)
    .option("--timeout-ms <n>", "Override per-task timeout in milliseconds", parsePositiveInt)
    .option("--max-output-tokens <n>", "Cap output tokens per model call", parsePositiveInt)
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined, options: {
      models?: string[];
      trials?: number;
      parallelism?: number;
      appParallelism?: number;
      maxSteps?: number;
      timeoutMs?: number;
      maxOutputTokens?: number;
    }) => {
      if (app) {
        const result = await runQaExperiment({
          appId: app,
          models: options.models,
          trials: options.trials,
          parallelism: options.parallelism,
          maxSteps: options.maxSteps,
          timeoutMs: options.timeoutMs,
          maxOutputTokens: options.maxOutputTokens,
          onLog: input.onLog
        });
        printSingleRun(result);
        return;
      }

      const result = await runQaAcrossApps({
        models: options.models,
        trials: options.trials,
        parallelism: options.parallelism,
        appParallelism: options.appParallelism,
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxOutputTokens: options.maxOutputTokens,
        onLog: input.onLog
      });
      printMultiRun(result);
    });

}

async function main(): Promise<void> {
  await loadProjectEnv();
  const onLog = createProgressLogger();

  const program = new Command();
  program
    .name("agentic-qa")
    .description("Production benchmark CLI for guided runs, exploration, self-healing, and report rebuilds")
    .showHelpAfterError();

  registerGuidedCommand(program, { name: "guided", onLog });

  program
    .command("explore")
    .description("Run the autonomous exploration benchmark; omit app to run all benchmark apps")
    .option("--parallelism <n>", "Run up to this many models in parallel per app", parsePositiveInt)
    .option("--app-parallelism <n>", "Run up to this many apps in parallel for multi-app mode", parsePositiveInt)
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined, options: {
      parallelism?: number;
      appParallelism?: number;
    }) => {
      if (app) {
        const result = await runExploreExperiment({
          appId: app,
          parallelism: options.parallelism,
          onLog
        });
        printSingleRun(result);
        return;
      }

      const result = await runExploreAcrossApps({
        parallelism: options.parallelism,
        appParallelism: options.appParallelism,
        onLog
      });
      printMultiRun(result);
    });

  program
    .command("heal")
    .description("Run the self-healing benchmark; omit app to run all benchmark apps")
    .option("--parallelism <n>", "Run up to this many models in parallel per app", parsePositiveInt)
    .option("--app-parallelism <n>", "Run up to this many apps in parallel for multi-app mode", parsePositiveInt)
    .argument("[app]", "Benchmark app identifier")
    .action(async (app: string | undefined, options: {
      parallelism?: number;
      appParallelism?: number;
    }) => {
      if (app) {
        const result = await runHealExperiment({
          appId: app,
          parallelism: options.parallelism,
          onLog
        });
        printSingleRun(result);
        return;
      }

      const result = await runHealAcrossApps({
        parallelism: options.parallelism,
        appParallelism: options.appParallelism,
        onLog
      });
      printMultiRun(result);
    });

  program
    .command("report")
    .description("Rebuild comparison reports from saved benchmark report JSON files")
    .argument("[mode]", "Benchmark mode to rebuild (guided, explore, or heal)")
    .action(async (mode: string | undefined) => {
      const reportMode = normalizeReportMode(mode);

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
