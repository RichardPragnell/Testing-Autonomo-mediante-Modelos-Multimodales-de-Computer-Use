#!/usr/bin/env node
import { Command } from "commander";
import {
  loadProjectEnv,
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

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`bench failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
