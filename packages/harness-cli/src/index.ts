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

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  await loadProjectEnv();

  const program = new Command();
  program
    .name("bench")
    .description("Production benchmark CLI for QA, exploration, and self-healing")
    .showHelpAfterError();

  program
    .command("qa")
    .description("Run the guided QA benchmark")
    .argument("<app>", "Benchmark app identifier")
    .action(async (app: string) => {
      const result = await runQaExperiment({
        appId: app
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
        appId: app
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
        appId: app
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
        suitePath: `apps/${app}/benchmark.json`
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
      const result = await compareBenchmarkRuns(runIds);
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
