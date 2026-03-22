import { z } from "zod";
import {
  compareBenchmarkRuns,
  describeTarget,
  exploreTarget,
  getBenchmarkReport,
  listSuites,
  listTargets,
  runGuided,
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
    name: "bench.explore_target",
    description: "Run runtime-prompt autonomous exploration for a target and persist history, graph, and action cache artifacts.",
    inputSchema: {
      targetId: z.string(),
      modelId: z.string().optional(),
      bugIds: z.array(z.string()).optional(),
      prompt: z.string().min(1),
      modelsPath: z.string().optional(),
      resultsDir: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      maxSteps: z.number().int().positive().optional(),
      viewport: z
        .object({
          width: z.number().int().positive(),
          height: z.number().int().positive()
        })
        .optional()
    },
    handler: async (input: {
      targetId: string;
      modelId?: string;
      bugIds?: string[];
      prompt: string;
      modelsPath?: string;
      resultsDir?: string;
      timeoutMs?: number;
      retryCount?: number;
      maxSteps?: number;
      viewport?: {
        width: number;
        height: number;
      };
    }) => exploreTarget(input)
  },
  {
    name: "bench.run_guided",
    description: "Run scenario-backed guided execution with optional exploration cache reuse from a prior exploration run.",
    inputSchema: {
      targetId: z.string(),
      scenarioIds: z.array(z.string()).min(1),
      modelId: z.string().optional(),
      bugIds: z.array(z.string()).optional(),
      modelsPath: z.string().optional(),
      resultsDir: z.string().optional(),
      guidedPromptId: z.string().optional(),
      explorationRunId: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      maxSteps: z.number().int().positive().optional(),
      viewport: z
        .object({
          width: z.number().int().positive(),
          height: z.number().int().positive()
        })
        .optional()
    },
    handler: async (input: {
      targetId: string;
      scenarioIds: string[];
      modelId?: string;
      bugIds?: string[];
      modelsPath?: string;
      resultsDir?: string;
      guidedPromptId?: string;
      explorationRunId?: string;
      timeoutMs?: number;
      retryCount?: number;
      maxSteps?: number;
      viewport?: {
        width: number;
        height: number;
      };
    }) => runGuided(input)
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
