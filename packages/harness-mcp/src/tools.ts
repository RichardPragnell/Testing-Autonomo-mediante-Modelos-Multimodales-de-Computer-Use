import { z } from "zod";
import {
  type ExploreTargetInput,
  type RunBenchmarkSuiteInput,
  type RunGuidedInput,
  type RunSelfHealInput,
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

type ToolInput = Record<string, unknown>;

export interface ToolContract {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: ToolInput) => Promise<unknown>;
}

const viewportInputSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const toolContracts: ToolContract[] = [
  {
    name: "bench.run_suite",
    description: "Run a benchmark suite and persist workspace artifacts plus report output.",
    inputSchema: {
      suitePath: z.string(),
      modelsPath: z.string().optional()
    },
    handler: async (input) => runBenchmarkSuite(input as unknown as RunBenchmarkSuiteInput)
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
      viewport: viewportInputSchema.optional()
    },
    handler: async (input) => exploreTarget(input as unknown as ExploreTargetInput)
  },
  {
    name: "bench.run_guided",
    description:
      "Run scenario-backed guided execution with Stagehand cache-first replay; explorationRunId is optional linkage to a prior exploration artifact for compatibility reporting only.",
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
      viewport: viewportInputSchema.optional()
    },
    handler: async (input) => runGuided(input as unknown as RunGuidedInput)
  },
  {
    name: "bench.get_report",
    description: "Get a generated benchmark report by run ID.",
    inputSchema: { runId: z.string() },
    handler: async (input) => getBenchmarkReport(input.runId as string)
  },
  {
    name: "bench.compare_runs",
    description: "Compare model performance across benchmark run IDs.",
    inputSchema: { runIds: z.array(z.string()).min(1) },
    handler: async (input) => compareBenchmarkRuns(input.runIds as string[])
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
    handler: async (input) => runSelfHeal(input as unknown as RunSelfHealInput)
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
    handler: async (input) => describeTarget(input.targetId as string)
  }
];
