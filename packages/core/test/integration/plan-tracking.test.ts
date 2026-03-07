import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { appendPlanEvent, getNextStep, getPlanStatus, updatePlanStep } from "../../src/tracking/plan.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("plan tracking", () => {
  it("reads and updates step status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-track-"));
    dirs.push(dir);
    const planPath = join(dir, "MASTER_PLAN.md");
    const eventsPath = join(dir, "events.jsonl");

    await writeFile(
      planPath,
      [
        "### P0",
        "- step_id: P0",
        "- goal: bootstrap",
        "- definition_of_done: build passes",
        "- evidence_required: logs",
        "- owner: codex",
        "- status: in_progress",
        "- last_update: 2026-03-07",
        "",
        "### P1",
        "- step_id: P1",
        "- goal: runner",
        "- definition_of_done: works",
        "- evidence_required: test",
        "- owner: codex",
        "- status: not_started",
        "- last_update: 2026-03-07"
      ].join("\n"),
      "utf8"
    );
    await appendPlanEvent(eventsPath, {
      timestamp: "2026-03-07T00:00:00.000Z",
      type: "milestone",
      note: "init",
      evidence: []
    });

    const status = await getPlanStatus(planPath);
    expect(status.steps).toHaveLength(2);
    expect((await getNextStep(planPath))?.stepId).toBe("P0");

    const updated = await updatePlanStep(
      {
        stepId: "P0",
        status: "done",
        note: "completed",
        evidence: ["test-output"]
      },
      planPath,
      eventsPath
    );

    expect(updated.steps.find((step) => step.stepId === "P0")?.status).toBe("done");
  });
});

