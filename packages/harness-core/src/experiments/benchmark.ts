import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BenchmarkScenario } from "../types.js";
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
  scenarioIds: z.array(z.string().min(1)).min(1)
});

const healCaseSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(1),
  bugId: z.string().min(1),
  reproductionScenarioIds: z.array(z.string().min(1)).min(1),
  regressionScenarioIds: z.array(z.string().min(1)).default([]),
  goldTouchedFiles: z.array(z.string().min(1)).min(1),
  validationCommand: z.string().optional()
});

const benchmarkSchema = z
  .object({
    appId: z.string().min(1),
    displayName: z.string().min(1),
    prompts: z
      .object({
        guided: z.string().min(1).optional(),
        qa: z.string().min(1).optional(),
        explore: z.string().min(1),
        heal: z.string().min(1)
      })
      .superRefine((value, ctx) => {
        if (!value.guided && !value.qa) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "prompts.guided is required"
          });
        }
      }),
    runtime: z
      .object({
        timeoutMs: z.number().int().positive(),
        retryCount: z.number().int().min(0),
        maxSteps: z.number().int().positive(),
        viewport: z.object({
          width: z.number().int().positive(),
          height: z.number().int().positive()
        }),
        guidedTrials: z.number().int().min(1).optional(),
        qaTrials: z.number().int().min(1).optional(),
        exploreTrials: z.number().int().min(1),
        healTrials: z.number().int().min(1)
      })
      .superRefine((value, ctx) => {
        if (value.guidedTrials === undefined && value.qaTrials === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "runtime.guidedTrials is required"
          });
        }
      }),
    capabilities: z.array(capabilitySchema).min(1),
    guided: z
      .object({
        capabilityIds: z.array(z.string().min(1)).min(1)
      })
      .optional(),
    qa: z
      .object({
        capabilityIds: z.array(z.string().min(1)).min(1)
      })
      .optional(),
    explore: z.object({
      capabilityIds: z.array(z.string().min(1)).min(1),
      probeScenarioIds: z.array(z.string().min(1)).min(1),
      runtime: z
        .object({
          timeoutMs: z.number().int().positive().optional(),
          retryCount: z.number().int().min(0).optional(),
          maxSteps: z.number().int().positive().optional()
        })
        .optional(),
      heuristicTargets: z.object({
        minStates: z.number().int().positive(),
        minTransitions: z.number().int().positive(),
        actionKinds: z.array(z.string().min(1)).min(1)
      })
    }),
    heal: z.object({
      caseIds: z.array(z.string().min(1)).min(1),
      runtime: z
        .object({
          timeoutMs: z.number().int().positive().optional(),
          retryCount: z.number().int().min(0).optional(),
          maxSteps: z.number().int().positive().optional()
        })
        .optional(),
      cases: z.array(healCaseSchema).min(1)
    })
  })
  .superRefine((value, ctx) => {
    if (!value.guided && !value.qa) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "guided configuration is required"
      });
    }
  });

function normalizeBenchmarkManifest(parsed: z.infer<typeof benchmarkSchema>): AppBenchmarkManifest {
  return {
    appId: parsed.appId,
    displayName: parsed.displayName,
    prompts: {
      guided: parsed.prompts.guided ?? parsed.prompts.qa!,
      explore: parsed.prompts.explore,
      heal: parsed.prompts.heal
    },
    runtime: {
      timeoutMs: parsed.runtime.timeoutMs,
      retryCount: parsed.runtime.retryCount,
      maxSteps: parsed.runtime.maxSteps,
      viewport: parsed.runtime.viewport,
      guidedTrials: parsed.runtime.guidedTrials ?? parsed.runtime.qaTrials!,
      exploreTrials: parsed.runtime.exploreTrials,
      healTrials: parsed.runtime.healTrials
    },
    capabilities: parsed.capabilities,
    guided: parsed.guided ?? parsed.qa!,
    explore: parsed.explore,
    heal: parsed.heal
  };
}

function ensureScenarioIdsExist(
  scenarioIds: string[],
  scenarioMap: Map<string, BenchmarkScenario>,
  context: string
): void {
  for (const scenarioId of scenarioIds) {
    if (!scenarioMap.has(scenarioId)) {
      throw new Error(`${context} references unknown scenario ${scenarioId}`);
    }
  }
}

function ensureCapabilityIdsExist(
  capabilityIds: string[],
  capabilityMap: Map<string, CapabilityDefinition>,
  context: string
): void {
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
  const benchmark = normalizeBenchmarkManifest(benchmarkSchema.parse(JSON.parse(raw)));
  const target = await describeBenchmarkTarget(appId, appsRoot);

  const scenarios = new Map<string, BenchmarkScenario>();
  for (const scenario of target.scenarios) {
    scenarios.set(scenario.scenarioId, scenario);
  }

  const capabilityMap = new Map<string, CapabilityDefinition>(
    benchmark.capabilities.map((capability) => [capability.capabilityId, capability])
  );
  const healCaseMap = new Map<string, HealCaseDefinition>(
    benchmark.heal.cases.map((item) => [item.caseId, item])
  );

  ensureCapabilityIdsExist(benchmark.guided.capabilityIds, capabilityMap, "guided");
  ensureCapabilityIdsExist(benchmark.explore.capabilityIds, capabilityMap, "explore");
  ensureScenarioIdsExist(benchmark.explore.probeScenarioIds, scenarios, "explore");
  ensureHealCaseIdsExist(benchmark.heal.caseIds, healCaseMap);

  for (const capability of benchmark.capabilities) {
    ensureScenarioIdsExist(capability.scenarioIds, scenarios, `capability ${capability.capabilityId}`);
  }

  for (const item of benchmark.heal.cases) {
    ensureScenarioIdsExist(item.reproductionScenarioIds, scenarios, `heal case ${item.caseId}`);
    ensureScenarioIdsExist(item.regressionScenarioIds, scenarios, `heal case ${item.caseId}`);
    if (!target.bugs.some((bug) => bug.bugId === item.bugId)) {
      throw new Error(`heal case ${item.caseId} references unknown bug ${item.bugId}`);
    }
  }

  return {
    manifestPath,
    benchmark,
    target,
    scenarios,
    capabilityMap,
    healCaseMap
  };
}
