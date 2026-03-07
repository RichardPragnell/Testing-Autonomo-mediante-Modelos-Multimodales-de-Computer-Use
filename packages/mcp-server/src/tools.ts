import { z } from "zod";
import {
  compareModels,
  getReport,
  planNext,
  planStatus,
  planUpdate,
  runExperiment,
  runSelfHeal
} from "@agentic-qa/core";

export interface ToolContract {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: any) => Promise<any>;
}

export const toolContracts: ToolContract[] = [
  {
    name: "qa.run_experiment",
    description: "Run a benchmark experiment from spec and persist artifacts/report.",
    inputSchema: {
      specPath: z.string(),
      modelsPath: z.string().optional()
    },
    handler: async ({ specPath, modelsPath }: { specPath: string; modelsPath?: string }) =>
      runExperiment({ specPath, modelsPath })
  },
  {
    name: "qa.get_report",
    description: "Get generated report by run ID.",
    inputSchema: { runId: z.string() },
    handler: async ({ runId }: { runId: string }) => getReport(runId)
  },
  {
    name: "qa.compare_models",
    description: "Compare model performance across run IDs.",
    inputSchema: { runIds: z.array(z.string()).min(1) },
    handler: async ({ runIds }: { runIds: string[] }) => compareModels(runIds)
  },
  {
    name: "qa.run_self_heal",
    description: "Run self-healing for a specific finding using a coding-agent command.",
    inputSchema: {
      runId: z.string(),
      findingId: z.string(),
      agentCommand: z.string(),
      validationCommand: z.string().optional()
    },
    handler: async ({
      runId,
      findingId,
      agentCommand,
      validationCommand
    }: {
      runId: string;
      findingId: string;
      agentCommand: string;
      validationCommand?: string;
    }) =>
      runSelfHeal({
        runId,
        findingId,
        agentCommand,
        validationCommand
      })
  },
  {
    name: "plan.status",
    description: "Read plan checklist and blockers from docs/MASTER_PLAN.md.",
    inputSchema: {},
    handler: async () => planStatus()
  },
  {
    name: "plan.updateStep",
    description: "Update a plan step status and append structured event log.",
    inputSchema: {
      stepId: z.string(),
      status: z.enum(["not_started", "in_progress", "blocked", "done", "verified"]),
      note: z.string(),
      evidence: z.array(z.string()).default([])
    },
    handler: async ({
      stepId,
      status,
      note,
      evidence
    }: {
      stepId: string;
      status: "not_started" | "in_progress" | "blocked" | "done" | "verified";
      note: string;
      evidence: string[];
    }) => planUpdate({ stepId, status, note, evidence })
  },
  {
    name: "plan.next",
    description: "Return next executable step.",
    inputSchema: {},
    handler: async () => planNext()
  }
];
