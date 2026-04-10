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

function printFullBench(result: {
  guided: {
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
  };
  explore: {
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
  };
  heal: {
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
  };
  report: {
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
  };
}): void {
  print({
    guided: {
      mode: toPublicMode(result.guided.mode),
      appIds: result.guided.appIds,
      runs: result.guided.runs,
      finalReportPath: result.guided.finalReportPath,
      finalJsonPath: result.guided.finalJsonPath
    },
    explore: {
      mode: toPublicMode(result.explore.mode),
      appIds: result.explore.appIds,
      runs: result.explore.runs,
      finalReportPath: result.explore.finalReportPath,
      finalJsonPath: result.explore.finalJsonPath
    },
    heal: {
      mode: toPublicMode(result.heal.mode),
      appIds: result.heal.appIds,
      runs: result.heal.runs,
      finalReportPath: result.heal.finalReportPath,
      finalJsonPath: result.heal.finalJsonPath
    },
    rebuiltReports: result.report.modeReports.map((entry) => ({
      ...entry,
      kind: toPublicMode(entry.kind)
    })),
    finalReportPath: result.report.finalReportPath,
    finalJsonPath: result.report.finalJsonPath
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

function normalizeHtmlScope(scope: string | undefined): "compare" | "all" {
  if (!scope || scope === "compare") {
    return "compare";
  }
  if (scope === "all") {
    return "all";
  }
  throw new Error(`unsupported html scope ${scope}`);
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
    .option("--max-steps <n>", "Override guided scenario step budget", parsePositiveInt)
    .option("--timeout-ms <n>", "Override per-scenario timeout in milliseconds", parsePositiveInt)
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
    .command("fullbench")
    .description("Run guided, explore, and heal sequentially across all benchmark apps, then rebuild final reports")
    .option("--models <ids...>", "Explicit OpenRouter model IDs for the guided phase")
    .option("--trials <n>", "Override guided trial count", parsePositiveInt)
    .option("--parallel <n>", "Alias for --parallelism", parsePositiveInt)
    .option("--parallelism <n>", "Run up to this many models in parallel per app within each phase", parsePositiveInt)
    .option("--app-parallelism <n>", "Run up to this many apps in parallel within each phase", parsePositiveInt)
    .option("--max-steps <n>", "Override guided scenario step budget", parsePositiveInt)
    .option("--timeout-ms <n>", "Override guided per-scenario timeout in milliseconds", parsePositiveInt)
    .option("--max-output-tokens <n>", "Cap guided output tokens per model call", parsePositiveInt)
    .option("--html-scope <scope>", "Final report rebuild HTML scope: compare or all")
    .action(async (options: {
      models?: string[];
      trials?: number;
      parallel?: number;
      parallelism?: number;
      appParallelism?: number;
      maxSteps?: number;
      timeoutMs?: number;
      maxOutputTokens?: number;
      htmlScope?: string;
    }) => {
      const htmlScope = normalizeHtmlScope(options.htmlScope ?? "all");
      const parallelism = options.parallel ?? options.parallelism;

      const guided = await runQaAcrossApps({
        models: options.models,
        trials: options.trials,
        parallelism,
        appParallelism: options.appParallelism,
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxOutputTokens: options.maxOutputTokens,
        onLog
      });

      const explore = await runExploreAcrossApps({
        parallelism,
        appParallelism: options.appParallelism,
        onLog
      });

      const heal = await runHealAcrossApps({
        parallelism,
        appParallelism: options.appParallelism,
        onLog
      });

      const report = await rebuildBenchmarkReports({
        htmlScope
      });

      printFullBench({
        guided,
        explore,
        heal,
        report
      });
    });

  program
    .command("report")
    .description("Rebuild comparison reports from saved benchmark report JSON files")
    .option("--html-scope <scope>", "HTML rebuild scope: compare (default) or all")
    .argument("[mode]", "Benchmark mode to rebuild (guided, explore, or heal)")
    .action(async (mode: string | undefined, options: { htmlScope?: string }) => {
      const reportMode = normalizeReportMode(mode);
      const htmlScope = normalizeHtmlScope(options.htmlScope);

      const result = await rebuildBenchmarkReports({
        mode: reportMode,
        htmlScope
      });
      printReportRebuild(result);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`benchmark command failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
