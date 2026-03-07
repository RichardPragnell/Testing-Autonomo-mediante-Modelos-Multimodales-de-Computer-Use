#!/usr/bin/env node
import { Command } from "commander";
import {
  compareModels,
  getReport,
  planNext,
  planStatus,
  planUpdate,
  runExperiment,
  runSelfHeal
} from "@agentic-qa/core";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("agentic-qa")
    .description("Stagehand-based agentic QA orchestration CLI")
    .showHelpAfterError();

  const qa = program.command("qa").description("QA orchestration commands");

  qa.command("run")
    .requiredOption("--spec <path>", "Path to experiment JSON spec")
    .option("--models-path <path>", "Path to model registry", "config/models.yaml")
    .action(async (options: { spec: string; modelsPath: string }) => {
      const result = await runExperiment({
        specPath: options.spec,
        modelsPath: options.modelsPath
      });
      print({
        runId: result.artifact.runId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath
      });
    });

  qa.command("report")
    .requiredOption("--run-id <id>", "Run ID")
    .action(async (options: { runId: string }) => {
      print(await getReport(options.runId));
    });

  qa.command("compare")
    .requiredOption("--run-ids <ids...>", "Run IDs to compare")
    .action(async (options: { runIds: string[] }) => {
      print(await compareModels(options.runIds));
    });

  qa.command("heal")
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

  const plan = program.command("plan").description("Implementation tracking commands");

  plan.command("status").action(async () => {
    print(await planStatus());
  });

  plan.command("update")
    .requiredOption("--step-id <id>", "Step identifier")
    .requiredOption("--status <status>", "Step status")
    .requiredOption("--note <text>", "Short note about update")
    .option("--evidence <items...>", "Evidence paths or references", [])
    .action(
      async (options: {
        stepId: string;
        status: "not_started" | "in_progress" | "blocked" | "done" | "verified";
        note: string;
        evidence: string[];
      }) => {
        print(
          await planUpdate({
            stepId: options.stepId,
            status: options.status,
            note: options.note,
            evidence: options.evidence
          })
        );
      }
    );

  plan.command("next").action(async () => {
    print(await planNext());
  });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`agentic-qa failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

