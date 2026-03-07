import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadCorpusTasks, normalizeTasks } from "../corpus/normalize.js";
import type { ExperimentSpec, ExperimentTask } from "../types.js";

const taskSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  expected: z.object({
    type: z.enum(["contains", "url_contains", "text_visible"]),
    value: z.string().min(1)
  }),
  source: z.enum(["synthetic", "generated"]).default("generated")
});

const experimentSchema = z.object({
  experimentId: z.string().min(1),
  aut: z.object({
    url: z.string().url(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional()
  }),
  tasks: z.array(taskSchema).default([]),
  corpusPaths: z.array(z.string()).default([]),
  models: z.array(z.string()).optional(),
  trials: z.number().int().min(1).default(5),
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
  outputDir: z.string().default("artifacts/runs")
});

export function validateExperimentSpec(input: unknown): ExperimentSpec {
  return experimentSchema.parse(input) as ExperimentSpec;
}

export async function loadExperimentSpec(input: {
  specPath?: string;
  spec?: Partial<ExperimentSpec>;
}): Promise<ExperimentSpec> {
  let base: Record<string, unknown> = {};
  if (input.specPath) {
    const raw = await readFile(input.specPath, "utf8");
    base = JSON.parse(raw) as Record<string, unknown>;
  }
  const merged = {
    ...base,
    ...input.spec
  };
  const parsed = validateExperimentSpec(merged);
  const explicitTasks = parsed.tasks as ExperimentTask[];
  const corpusTasks = await loadCorpusTasks(parsed.corpusPaths);
  const tasks = normalizeTasks(explicitTasks, corpusTasks);
  return {
    ...parsed,
    tasks
  };
}
