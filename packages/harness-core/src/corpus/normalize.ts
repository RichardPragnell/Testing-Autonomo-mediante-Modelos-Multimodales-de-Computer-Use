import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ExperimentTask } from "../types.js";

const rawTaskSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  expected: z.object({
    type: z.enum(["contains", "url_contains", "text_visible"]),
    value: z.string().min(1)
  }),
  source: z.enum(["synthetic", "curated"]).optional()
});

const corpusSchema = z.object({
  experiment_id: z.string().optional(),
  source: z.enum(["synthetic", "curated"]),
  tasks: z.array(rawTaskSchema).min(1)
});

function normalizeTask(task: z.infer<typeof rawTaskSchema>, fallbackSource: "synthetic" | "curated"): ExperimentTask {
  return {
    id: task.id,
    instruction: task.instruction,
    expected: task.expected,
    source: task.source ?? fallbackSource
  };
}

export async function loadCorpusTasks(corpusPaths: string[]): Promise<ExperimentTask[]> {
  const tasks: ExperimentTask[] = [];
  for (const corpusPath of corpusPaths) {
    const raw = await readFile(corpusPath, "utf8");
    const parsed = corpusSchema.parse(JSON.parse(raw));
    for (const task of parsed.tasks) {
      tasks.push(normalizeTask(task, parsed.source));
    }
  }
  return tasks;
}

export function normalizeTasks(explicitTasks: ExperimentTask[], corpusTasks: ExperimentTask[]): ExperimentTask[] {
  const byId = new Map<string, ExperimentTask>();
  for (const task of [...corpusTasks, ...explicitTasks]) {
    byId.set(task.id, task);
  }
  return [...byId.values()];
}

