import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { toolContracts } from "../src/tools.js";

const previousCwd = process.cwd();

beforeAll(() => {
  process.chdir(resolve(previousCwd, "..", ".."));
});

afterAll(() => {
  process.chdir(previousCwd);
});

describe("MCP tool contracts", () => {
  it("registers required QA and plan tools", () => {
    const names = toolContracts.map((tool) => tool.name);
    expect(names).toContain("qa.run_experiment");
    expect(names).toContain("qa.get_report");
    expect(names).toContain("qa.compare_models");
    expect(names).toContain("qa.run_self_heal");
    expect(names).toContain("plan.status");
    expect(names).toContain("plan.updateStep");
    expect(names).toContain("plan.next");
  });

  it("enforces input schema for plan.updateStep", () => {
    const tool = toolContracts.find((item) => item.name === "plan.updateStep");
    expect(tool).toBeDefined();
    expect(() =>
      z.object(tool!.inputSchema).parse({
        stepId: "P0",
        status: "invalid_status",
        note: "x",
        evidence: []
      })
    ).toThrow();
  });

  it("keeps plan.status idempotent for repeated reads", async () => {
    const tool = toolContracts.find((item) => item.name === "plan.status");
    expect(tool).toBeDefined();
    const first = await tool!.handler({});
    const second = await tool!.handler({});
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
