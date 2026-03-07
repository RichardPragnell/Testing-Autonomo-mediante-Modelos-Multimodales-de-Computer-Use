import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { PlanEvent, PlanSnapshot, PlanStep, PlanUpdateInput, StepStatus } from "../types.js";
import { nowIso, todayDate } from "../utils/time.js";

const statusSet = new Set<StepStatus>(["not_started", "in_progress", "blocked", "done", "verified"]);

async function resolveWorkspacePath(pathLike: string): Promise<string> {
  if (isAbsolute(pathLike)) {
    return pathLike;
  }
  let cursor = process.cwd();
  while (true) {
    const candidate = join(cursor, pathLike);
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  return resolve(process.cwd(), pathLike);
}

function parseSteps(markdown: string): PlanStep[] {
  const lines = markdown.split(/\r?\n/);
  const steps: PlanStep[] = [];
  let current: Partial<PlanStep> | undefined;
  let currentId = "";

  const pushCurrent = (): void => {
    if (!current || !currentId) {
      return;
    }
    if (
      current.goal &&
      current.definitionOfDone &&
      current.evidenceRequired &&
      current.owner &&
      current.status &&
      current.lastUpdate
    ) {
      steps.push({
        stepId: currentId,
        goal: current.goal,
        definitionOfDone: current.definitionOfDone,
        evidenceRequired: current.evidenceRequired,
        owner: current.owner,
        status: current.status,
        lastUpdate: current.lastUpdate
      });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^###\s+([A-Za-z0-9_-]+)/);
    if (heading) {
      pushCurrent();
      current = {};
      currentId = heading[1];
      continue;
    }
    if (!current) {
      continue;
    }
    const field = line.match(/^- ([a-z_]+):\s*(.*)$/);
    if (!field) {
      continue;
    }
    const key = field[1];
    const value = field[2].trim();
    if (key === "goal") {
      current.goal = value;
    } else if (key === "definition_of_done") {
      current.definitionOfDone = value;
    } else if (key === "evidence_required") {
      current.evidenceRequired = value;
    } else if (key === "owner") {
      current.owner = value;
    } else if (key === "status" && statusSet.has(value as StepStatus)) {
      current.status = value as StepStatus;
    } else if (key === "last_update") {
      current.lastUpdate = value;
    }
  }
  pushCurrent();
  return steps;
}

export async function getPlanStatus(planPath = "docs/MASTER_PLAN.md"): Promise<PlanSnapshot> {
  const resolvedPlanPath = await resolveWorkspacePath(planPath);
  const markdown = await readFile(resolvedPlanPath, "utf8");
  const steps = parseSteps(markdown);
  return {
    path: resolvedPlanPath,
    steps,
    blockers: steps.filter((step) => step.status === "blocked")
  };
}

export async function getNextStep(planPath = "docs/MASTER_PLAN.md"): Promise<PlanStep | undefined> {
  const snapshot = await getPlanStatus(planPath);
  const inProgress = snapshot.steps.find((step) => step.status === "in_progress");
  if (inProgress) {
    return inProgress;
  }
  return snapshot.steps.find((step) => step.status === "not_started");
}

function updateStepBlock(markdown: string, stepId: string, status: StepStatus): string {
  const lines = markdown.split(/\r?\n/);
  const updated: string[] = [];
  let inTarget = false;
  let found = false;

  for (const line of lines) {
    const heading = line.match(/^###\s+([A-Za-z0-9_-]+)/);
    if (heading) {
      inTarget = heading[1] === stepId;
      if (inTarget) {
        found = true;
      }
      updated.push(line);
      continue;
    }
    if (!inTarget) {
      updated.push(line);
      continue;
    }
    if (line.startsWith("- status:")) {
      updated.push(`- status: ${status}`);
      continue;
    }
    if (line.startsWith("- last_update:")) {
      updated.push(`- last_update: ${todayDate()}`);
      continue;
    }
    updated.push(line);
  }
  if (!found) {
    throw new Error(`step ${stepId} was not found in ${"docs/MASTER_PLAN.md"}`);
  }
  return `${updated.join("\n").replace(/\n+$/g, "")}\n`;
}

export async function appendPlanEvent(eventPath: string, event: PlanEvent): Promise<void> {
  const resolvedEventPath = await resolveWorkspacePath(eventPath);
  await mkdir(dirname(resolvedEventPath), { recursive: true });
  await appendFile(resolvedEventPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function updatePlanStep(
  input: PlanUpdateInput,
  planPath = "docs/MASTER_PLAN.md",
  eventPath = "docs/progress/events.jsonl"
): Promise<PlanSnapshot> {
  const resolvedPlanPath = await resolveWorkspacePath(planPath);
  const markdown = await readFile(resolvedPlanPath, "utf8");
  const updated = updateStepBlock(markdown, input.stepId, input.status);
  await writeFile(resolvedPlanPath, updated, "utf8");
  await appendPlanEvent(eventPath, {
    timestamp: nowIso(),
    type: "status_change",
    step_id: input.stepId,
    status: input.status,
    note: input.note,
    evidence: input.evidence
  });
  return getPlanStatus(resolvedPlanPath);
}
