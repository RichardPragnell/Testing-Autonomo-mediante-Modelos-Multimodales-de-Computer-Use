import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BenchmarkTask } from "../types.js";
import { describeBenchmarkTarget } from "../config/target.js";
import { resolveWorkspacePath } from "../utils/fs.js";
import type {
  AppBenchmarkManifest,
  CapabilityDefinition,
  HealCaseDefinition,
  ResolvedAppBenchmark
} from "./types.js";

const capabilitySchema = z.object({
  capabilityId: z.string().min(1),
  title: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1)
});

const healCaseSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(1),
  bugId: z.string().min(1),
  reproductionTaskIds: z.array(z.string().min(1)).min(1),
  regressionTaskIds: z.array(z.string().min(1)).default([]),
  goldTouchedFiles: z.array(z.string().min(1)).min(1),
  validationCommand: z.string().optional()
});

const benchmarkSchema = z.object({
  appId: z.string().min(1),
  displayName: z.string().min(1),
  prompts: z.object({
    qa: z.string().min(1),
    explore: z.string().min(1),
    heal: z.string().min(1)
  }),
  runtime: z.object({
    timeoutMs: z.number().int().positive(),
    retryCount: z.number().int().min(0),
    maxSteps: z.number().int().positive(),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }),
    qaTrials: z.number().int().min(1),
    exploreTrials: z.number().int().min(1),
    healTrials: z.number().int().min(1)
  }),
  capabilities: z.array(capabilitySchema).min(1),
  qa: z.object({
    capabilityIds: z.array(z.string().min(1)).min(1)
  }),
  explore: z.object({
    capabilityIds: z.array(z.string().min(1)).min(1),
    probeTaskIds: z.array(z.string().min(1)).min(1),
    heuristicTargets: z.object({
      minStates: z.number().int().positive(),
      minTransitions: z.number().int().positive(),
      actionKinds: z.array(z.string().min(1)).min(1)
    })
  }),
  heal: z.object({
    caseIds: z.array(z.string().min(1)).min(1),
    cases: z.array(healCaseSchema).min(1)
  })
});

function ensureTaskIdsExist(taskIds: string[], taskMap: Map<string, BenchmarkTask>, context: string): void {
  for (const taskId of taskIds) {
    if (!taskMap.has(taskId)) {
      throw new Error(`${context} references unknown task ${taskId}`);
    }
  }
}

function ensureCapabilityIdsExist(capabilityIds: string[], capabilityMap: Map<string, CapabilityDefinition>, context: string): void {
  for (const capabilityId of capabilityIds) {
    if (!capabilityMap.has(capabilityId)) {
      throw new Error(`${context} references unknown capability ${capabilityId}`);
    }
  }
}

function ensureHealCaseIdsExist(caseIds: string[], caseMap: Map<string, HealCaseDefinition>): void {
  for (const caseId of caseIds) {
    if (!caseMap.has(caseId)) {
      throw new Error(`heal configuration references unknown case ${caseId}`);
    }
  }
}

export async function loadAppBenchmark(appId: string, appsRoot = "apps"): Promise<ResolvedAppBenchmark> {
  const resolvedAppsRoot = await resolveWorkspacePath(appsRoot);
  const manifestPath = join(resolvedAppsRoot, appId, "benchmark.json");
  const raw = await readFile(manifestPath, "utf8");
  const benchmark = benchmarkSchema.parse(JSON.parse(raw)) as AppBenchmarkManifest;
  const target = await describeBenchmarkTarget(appId, appsRoot);

  const tasks = new Map<string, BenchmarkTask>();
  for (const scenario of target.scenarios) {
    for (const task of scenario.tasks) {
      tasks.set(task.id, task);
    }
  }

  const capabilityMap = new Map<string, CapabilityDefinition>(
    benchmark.capabilities.map((capability) => [capability.capabilityId, capability])
  );
  const healCaseMap = new Map<string, HealCaseDefinition>(
    benchmark.heal.cases.map((item) => [item.caseId, item])
  );

  ensureCapabilityIdsExist(benchmark.qa.capabilityIds, capabilityMap, "qa");
  ensureCapabilityIdsExist(benchmark.explore.capabilityIds, capabilityMap, "explore");
  ensureTaskIdsExist(benchmark.explore.probeTaskIds, tasks, "explore");
  ensureHealCaseIdsExist(benchmark.heal.caseIds, healCaseMap);

  for (const capability of benchmark.capabilities) {
    ensureTaskIdsExist(capability.taskIds, tasks, `capability ${capability.capabilityId}`);
  }

  for (const item of benchmark.heal.cases) {
    ensureTaskIdsExist(item.reproductionTaskIds, tasks, `heal case ${item.caseId}`);
    ensureTaskIdsExist(item.regressionTaskIds, tasks, `heal case ${item.caseId}`);
    if (!target.bugs.some((bug) => bug.bugId === item.bugId)) {
      throw new Error(`heal case ${item.caseId} references unknown bug ${item.bugId}`);
    }
  }

  return {
    manifestPath,
    benchmark,
    target,
    tasks,
    capabilityMap,
    healCaseMap
  };
}
