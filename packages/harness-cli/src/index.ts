#!/usr/bin/env node
import { Command } from "commander";
import {
  compareBenchmarkRuns,
  describeTarget,
  getBenchmarkReport,
  loadProjectEnv,
  listSuites,
  listTargets,
  runBenchmarkSuite,
  runSelfHeal
} from "@agentic-qa/harness-core";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  await loadProjectEnv();

  const program = new Command();
  program
    .name("bench")
    .description("Benchmark-first harness CLI for local web QA, exploration, and self-healing")
    .showHelpAfterError();

  program
    .command("run")
    .requiredOption("--suite <path>", "Path to benchmark suite JSON")
    .option("--models-path <path>", "Path to model registry", "experiments/models/registry.yaml")
    .action(async (options: { suite: string; modelsPath: string }) => {
      const result = await runBenchmarkSuite({
        suitePath: options.suite,
        modelsPath: options.modelsPath
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath
      });
    });

  program
    .command("report")
    .requiredOption("--run-id <id>", "Run ID")
    .action(async (options: { runId: string }) => {
      print(await getBenchmarkReport(options.runId));
    });

  program
    .command("compare")
    .requiredOption("--run-ids <ids...>", "Run IDs to compare")
    .action(async (options: { runIds: string[] }) => {
      print(await compareBenchmarkRuns(options.runIds));
    });

  program
    .command("heal")
    .requiredOption("--run-id <id>", "Run ID")
    .requiredOption("--finding-id <id>", "Finding ID")
    .requiredOption("--agent-command <command>", "Command that receives context JSON via stdin and returns unified diff")
    .option("--validation-command <command>", "Validation command in isolated worktree")
    .action(
      async (options: {
        runId: string;
        findingId: string;
        agentCommand: string;
        validationCommand?: string;
      }) => {
        print(
          await runSelfHeal({
            runId: options.runId,
            findingId: options.findingId,
            agentCommand: options.agentCommand,
            validationCommand: options.validationCommand
          })
        );
      }
    );

  const list = program.command("list").description("List benchmark resources");

  list.command("targets").action(async () => {
    print(await listTargets());
  });

  list.command("suites").action(async () => {
    print(await listSuites());
  });

  const describe = program.command("describe").description("Describe benchmark resources");

  describe
    .command("target")
    .requiredOption("--target <id>", "Target identifier")
    .action(async (options: { target: string }) => {
      print(await describeTarget(options.target));
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`bench failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
