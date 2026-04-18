import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type {
  BenchmarkScenario,
  BenchmarkTarget,
  ResolvedBenchmarkTarget,
  ResolvedBugPack
} from "../types.js";
import { resolveWorkspacePath } from "../utils/fs.js";

const extractMatchSchema = z.union([
  z.object({ equals: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
  z.object({ contains: z.string().min(1) }).strict(),
  z.object({ not_contains: z.string().min(1) }).strict(),
  z.object({ includes: z.string().min(1) }).strict(),
  z.object({ excludes: z.string().min(1) }).strict()
]);

const observeAssertionSchema = z.object({
  assertionId: z.string().min(1),
  type: z.literal("observe"),
  instruction: z.string().min(1),
  exists: z.boolean(),
  method: z.string().min(1).optional(),
  descriptionContains: z.string().min(1).optional()
});

const extractAssertionSchema = z.object({
  assertionId: z.string().min(1),
  type: z.literal("extract"),
  instruction: z.string().min(1),
  selector: z.string().min(1).optional(),
  resultType: z.enum(["string", "number", "boolean", "string_array"]),
  match: extractMatchSchema
});

const stepSchema = z.object({
  stepId: z.string().min(1),
  title: z.string().min(1),
  actionInstruction: z.string().min(1).optional(),
  assertions: z.array(z.union([observeAssertionSchema, extractAssertionSchema])).min(1)
});

const scenarioSchema = z.object({
  scenarioId: z.string().min(1),
  title: z.string().min(1),
  source: z.enum(["synthetic", "generated"]),
  steps: z.array(stepSchema).min(1)
});

const bugSchema = z.object({
  bugId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["navigation", "locator", "state", "assertion", "timeout", "unexpected_ui", "unknown"]),
  severity: z.enum(["low", "medium", "high"]),
  patchPath: z.string().default("patch.diff"),
  expectedFailureScenarioIds: z.array(z.string()).default([]),
  validationCommand: z.string().optional()
});

const targetSchema = z.object({
  targetId: z.string().min(1),
  displayName: z.string().min(1),
  baseUrl: z.string().url(),
  devCommand: z.string().min(1),
  devEnv: z.record(z.string(), z.string()).optional(),
  defaultValidationCommand: z.string().min(1),
  templateDir: z.string().default("template"),
  bugsDir: z.string().default("bugs"),
  scenariosDir: z.string().default("scenarios")
});

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as unknown;
}

async function loadScenario(targetRoot: string, scenarioId: string, scenariosDir: string): Promise<BenchmarkScenario> {
  const path = join(targetRoot, scenariosDir, `${scenarioId}.json`);
  const parsed = scenarioSchema.parse(await readJson(path));
  return {
    scenarioId: parsed.scenarioId,
    title: parsed.title,
    source: parsed.source,
    steps: parsed.steps.map((step) => ({
      stepId: step.stepId,
      title: step.title,
      actionInstruction: step.actionInstruction,
      assertions: step.assertions,
      scenarioId: parsed.scenarioId
    }))
  };
}

async function loadBug(targetRoot: string, bugId: string, bugsDir: string): Promise<ResolvedBugPack> {
  const manifestPath = join(targetRoot, bugsDir, bugId, "bug.json");
  const parsed = bugSchema.parse(await readJson(manifestPath));
  const absolutePatchPath = resolve(targetRoot, bugsDir, bugId, parsed.patchPath);
  const patchText = await readFile(absolutePatchPath, "utf8");
  return {
    ...parsed,
    manifestPath,
    absolutePatchPath,
    touchedFiles: extractTouchedFiles(patchText)
  };
}

function extractTouchedFiles(patchText: string): string[] {
  const touchedFiles = new Set<string>();

  for (const line of patchText.split(/\r?\n/u)) {
    const diffMatch = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    if (diffMatch) {
      touchedFiles.add(diffMatch[2]);
      continue;
    }

    const plusMatch = /^\+\+\+ b\/(.+)$/u.exec(line);
    if (plusMatch) {
      touchedFiles.add(plusMatch[1]);
    }
  }

  return [...touchedFiles].sort();
}

export async function loadBenchmarkTarget(targetId: string, appsRoot = "apps"): Promise<ResolvedBenchmarkTarget> {
  const resolvedAppsRoot = await resolveWorkspacePath(appsRoot);
  const rootDir = join(resolvedAppsRoot, targetId);
  const manifestPath = join(rootDir, "target.json");
  const target = targetSchema.parse(await readJson(manifestPath)) as BenchmarkTarget;

  return {
    manifestPath,
    rootDir,
    templatePath: resolve(rootDir, target.templateDir),
    target,
    scenarios: [],
    bugs: []
  };
}

export async function resolveTargetSelections(input: {
  targetId: string;
  scenarioIds: string[];
  bugIds: string[];
  appsRoot?: string;
}): Promise<ResolvedBenchmarkTarget> {
  const base = await loadBenchmarkTarget(input.targetId, input.appsRoot);
  const scenarios = await Promise.all(
    input.scenarioIds.map((scenarioId) => loadScenario(base.rootDir, scenarioId, base.target.scenariosDir))
  );
  const bugs = await Promise.all(input.bugIds.map((bugId) => loadBug(base.rootDir, bugId, base.target.bugsDir)));
  return {
    ...base,
    scenarios,
    bugs
  };
}

export async function listBenchmarkTargets(appsRoot = "apps"): Promise<BenchmarkTarget[]> {
  const resolvedAppsRoot = await resolveWorkspacePath(appsRoot);
  const entries = await readdir(resolvedAppsRoot, { withFileTypes: true });
  const targets: BenchmarkTarget[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = join(resolvedAppsRoot, entry.name, "target.json");
    try {
      const target = targetSchema.parse(await readJson(manifestPath)) as BenchmarkTarget;
      targets.push(target);
    } catch {
      continue;
    }
  }
  return targets;
}

export async function describeBenchmarkTarget(targetId: string, appsRoot = "apps"): Promise<ResolvedBenchmarkTarget> {
  const base = await loadBenchmarkTarget(targetId, appsRoot);
  const scenarioEntries = await readdir(resolve(base.rootDir, base.target.scenariosDir), { withFileTypes: true });
  const bugEntries = await readdir(resolve(base.rootDir, base.target.bugsDir), { withFileTypes: true });
  const scenarioIds = scenarioEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/i, ""))
    .sort();
  const bugIds = bugEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return resolveTargetSelections({
    targetId,
    scenarioIds,
    bugIds,
    appsRoot
  });
}
