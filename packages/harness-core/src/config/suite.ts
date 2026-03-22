import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { BenchmarkSuite, BenchmarkTask, ResolvedBenchmarkSuite } from "../types.js";
import { resolveTargetSelections } from "./target.js";
import { loadPromptText } from "./prompt.js";
import { resolveWorkspacePath } from "../utils/fs.js";

const suiteSchema = z.object({
  suiteId: z.string().min(1),
  targetId: z.string().min(1),
  scenarioIds: z.array(z.string().min(1)).min(1),
  bugIds: z.array(z.string()).default([]),
  models: z.array(z.string()).optional(),
  explorationMode: z.enum(["guided", "autonomous"]),
  promptIds: z
    .object({
      guided: z.string().optional(),
      autonomous: z.string().optional(),
      repair: z.string().optional()
    })
    .optional(),
  trials: z.number().int().min(1).default(3),
  timeoutMs: z.number().int().positive().default(60_000),
  retryCount: z.number().int().min(0).default(1),
  maxSteps: z.number().int().positive().default(30),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .default({ width: 1280, height: 720 }),
  seed: z.number().int().default(42),
  resultsDir: z.string().default("results")
});

function normalizeTasks(tasks: BenchmarkTask[]): BenchmarkTask[] {
  const byId = new Map<string, BenchmarkTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }
  return [...byId.values()];
}

export function validateBenchmarkSuite(input: unknown): BenchmarkSuite {
  return suiteSchema.parse(input) as BenchmarkSuite;
}

export async function loadBenchmarkSuite(input: {
  suitePath?: string;
  suite?: Partial<BenchmarkSuite>;
}): Promise<ResolvedBenchmarkSuite> {
  let base: Record<string, unknown> = {};
  let suitePath = "";

  if (input.suitePath) {
    suitePath = await resolveWorkspacePath(input.suitePath);
    const raw = await readFile(suitePath, "utf8");
    base = JSON.parse(raw) as Record<string, unknown>;
  }

  const suite = validateBenchmarkSuite({
    ...base,
    ...input.suite
  });
  const target = await resolveTargetSelections({
    targetId: suite.targetId,
    scenarioIds: suite.scenarioIds,
    bugIds: suite.bugIds
  });

  const prompts = {
    guided: suite.promptIds?.guided ? await loadPromptText(suite.promptIds.guided) : undefined,
    autonomous: suite.promptIds?.autonomous ? await loadPromptText(suite.promptIds.autonomous) : undefined,
    repair: suite.promptIds?.repair ? await loadPromptText(suite.promptIds.repair) : undefined
  };

  const tasks = normalizeTasks(target.scenarios.flatMap((scenario) => scenario.tasks));

  return {
    suitePath,
    suite,
    target,
    selectedScenarios: target.scenarios,
    selectedBugs: target.bugs,
    tasks,
    prompts
  };
}

export async function listBenchmarkSuites(suitesRoot = "experiments/suites"): Promise<BenchmarkSuite[]> {
  const resolvedSuitesRoot = await resolveWorkspacePath(suitesRoot);
  const entries = await (await import("node:fs/promises")).readdir(resolvedSuitesRoot, { withFileTypes: true });
  const suites: BenchmarkSuite[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const raw = await readFile(`${resolvedSuitesRoot}/${entry.name}`, "utf8");
    suites.push(validateBenchmarkSuite(JSON.parse(raw)));
  }
  return suites;
}
