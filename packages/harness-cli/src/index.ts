#!/usr/bin/env node
import { Command } from "commander";
import {
  compareExploreRuns,
  compareHealRuns,
  compareQaRuns,
  getExploreReport,
  getHealReport,
  getQaReport,
  loadProjectEnv,
  MockAutomationRunner,
  MockRepairModelClient,
  runExploreExperiment,
  runHealExperiment,
  runQaExperiment
} from "@agentic-qa/harness-core";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseModels(raw?: string): string[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mockSeed(): number {
  const raw = process.env.BENCH_MOCK_SEED?.trim();
  return raw ? Number(raw) || 42 : 42;
}

function createAutomationRunner() {
  if (process.env.BENCH_USE_MOCK_RUNNER) {
    return new MockAutomationRunner(mockSeed());
  }
  return undefined;
}

function createRepairClient() {
  if (process.env.BENCH_USE_MOCK_REPAIR_MODEL) {
    return new MockRepairModelClient();
  }
  return undefined;
}

function applySharedRunOptions(command: Command): Command {
  return command
    .requiredOption("--app <id>", "Benchmark app identifier")
    .option("--models <ids>", "Comma-separated model ids")
    .option("--models-path <path>", "Path to model registry", "experiments/models/registry.yaml")
    .option("--trials <count>", "Trial count override", (value) => Number(value))
    .option("--results-dir <path>", "Results directory root", "results")
    .option("--preset <path>", "Optional preset JSON");
}

async function main(): Promise<void> {
  await loadProjectEnv();

  const program = new Command();
  program
    .name("bench")
    .description("Three-experiment benchmark CLI for QA, exploration, and self-healing")
    .showHelpAfterError();

  const qa = program.command("qa").description("Guided QA benchmark");
  applySharedRunOptions(qa.command("run").description("Run the QA benchmark")).action(
    async (options: {
      app: string;
      models?: string;
      modelsPath: string;
      trials?: number;
      resultsDir: string;
      preset?: string;
    }) => {
      const result = await runQaExperiment({
        appId: options.app,
        models: parseModels(options.models),
        modelsPath: options.modelsPath,
        trials: options.trials,
        resultsDir: options.resultsDir,
        presetPath: options.preset,
        runner: createAutomationRunner()
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    }
  );
  qa.command("report")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runId: string; resultsDir: string }) => {
      print(await getQaReport(options.runId, options.resultsDir));
    });
  qa.command("compare")
    .requiredOption("--run-ids <ids...>", "Run IDs to compare")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runIds: string[]; resultsDir: string }) => {
      print(await compareQaRuns(options.runIds, options.resultsDir));
    });

  const explore = program.command("explore").description("Autonomous exploration benchmark");
  applySharedRunOptions(explore.command("run").description("Run the exploration benchmark")).action(
    async (options: {
      app: string;
      models?: string;
      modelsPath: string;
      trials?: number;
      resultsDir: string;
      preset?: string;
    }) => {
      const result = await runExploreExperiment({
        appId: options.app,
        models: parseModels(options.models),
        modelsPath: options.modelsPath,
        trials: options.trials,
        resultsDir: options.resultsDir,
        presetPath: options.preset,
        runner: createAutomationRunner()
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    }
  );
  explore.command("report")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runId: string; resultsDir: string }) => {
      print(await getExploreReport(options.runId, options.resultsDir));
    });
  explore.command("compare")
    .requiredOption("--run-ids <ids...>", "Run IDs to compare")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runIds: string[]; resultsDir: string }) => {
      print(await compareExploreRuns(options.runIds, options.resultsDir));
    });

  const heal = program.command("heal").description("Self-healing benchmark");
  applySharedRunOptions(heal.command("run").description("Run the self-heal benchmark")).action(
    async (options: {
      app: string;
      models?: string;
      modelsPath: string;
      trials?: number;
      resultsDir: string;
      preset?: string;
    }) => {
      const result = await runHealExperiment({
        appId: options.app,
        models: parseModels(options.models),
        modelsPath: options.modelsPath,
        trials: options.trials,
        resultsDir: options.resultsDir,
        presetPath: options.preset,
        runner: createAutomationRunner(),
        repairClient: createRepairClient()
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        htmlPath: result.htmlPath
      });
    }
  );
  heal.command("report")
    .requiredOption("--run-id <id>", "Run ID")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runId: string; resultsDir: string }) => {
      print(await getHealReport(options.runId, options.resultsDir));
    });
  heal.command("compare")
    .requiredOption("--run-ids <ids...>", "Run IDs to compare")
    .option("--results-dir <path>", "Results directory root", "results")
    .action(async (options: { runIds: string[]; resultsDir: string }) => {
      print(await compareHealRuns(options.runIds, options.resultsDir));
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`bench failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
