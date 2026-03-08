import { z } from "zod";
import {
  compareBenchmarkRuns,
  describeTarget,
  getBenchmarkReport,
  listSuites,
  listTargets,
  runBenchmarkSuite,
  runSelfHeal
} from "@agentic-qa/harness-core";

export interface ToolContract {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: any) => Promise<any>;
}

export const toolContracts: ToolContract[] = [
  {
    name: "bench.run_suite",
    description: "Run a benchmark suite and persist workspace artifacts plus report output.",
    inputSchema: {
      suitePath: z.string(),
      modelsPath: z.string().optional()
    },
    handler: async ({ suitePath, modelsPath }: { suitePath: string; modelsPath?: string }) =>
      runBenchmarkSuite({ suitePath, modelsPath })
  },
  {
    name: "bench.get_report",
    description: "Get a generated benchmark report by run ID.",
    inputSchema: { runId: z.string() },
    handler: async ({ runId }: { runId: string }) => getBenchmarkReport(runId)
  },
  {
    name: "bench.compare_runs",
    description: "Compare model performance across benchmark run IDs.",
    inputSchema: { runIds: z.array(z.string()).min(1) },
    handler: async ({ runIds }: { runIds: string[] }) => compareBenchmarkRuns(runIds)
  },
  {
    name: "bench.run_self_heal",
    description: "Run self-healing for a specific finding against the cloned benchmark workspace.",
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
    name: "bench.list_targets",
    description: "List available benchmark targets.",
    inputSchema: {},
    handler: async () => listTargets()
  },
  {
    name: "bench.list_suites",
    description: "List available benchmark suites.",
    inputSchema: {},
    handler: async () => listSuites()
  },
  {
    name: "bench.describe_target",
    description: "Describe a benchmark target, including available scenarios and bug packs.",
    inputSchema: {
      targetId: z.string()
    },
    handler: async ({ targetId }: { targetId: string }) => describeTarget(targetId)
  }
];
