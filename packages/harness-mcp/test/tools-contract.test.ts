import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { toolContracts } from "../src/tools.js";

const previousCwd = process.cwd();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function getTool(name: string) {
  const tool = toolContracts.find((item) => item.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Missing tool contract: ${name}`);
  }
  return tool;
}

beforeAll(() => {
  process.chdir(repoRoot);
});

afterAll(() => {
  process.chdir(previousCwd);
});

describe("MCP tool contracts", () => {
  it("registers required benchmark tools", () => {
    const names = toolContracts.map((tool) => tool.name);
    expect(names).toContain("bench.run_suite");
    expect(names).toContain("bench.explore_target");
    expect(names).toContain("bench.run_guided");
    expect(names).toContain("bench.get_report");
    expect(names).toContain("bench.compare_runs");
    expect(names).toContain("bench.run_self_heal");
    expect(names).toContain("bench.list_targets");
    expect(names).toContain("bench.list_suites");
    expect(names).toContain("bench.describe_target");
  });

  it("enforces input schema for bench.describe_target", () => {
    const tool = getTool("bench.describe_target");
    expect(() => z.object(tool.inputSchema).parse({})).toThrow();
  });

  it("requires scenarioIds for bench.run_guided", () => {
    const tool = getTool("bench.run_guided");
    const schema = z.object(tool.inputSchema);

    expect(() => schema.parse({ targetId: "todo-react" })).toThrow();
    expect(() => schema.parse({ targetId: "todo-react", scenarioIds: [] })).toThrow();
    expect(() => schema.parse({ targetId: "todo-react", scenarioIds: ["smoke-load"] })).not.toThrow();
  });

  it("keeps bench.list_targets idempotent for repeated reads", async () => {
    const tool = getTool("bench.list_targets");
    const first = await tool.handler({});
    const second = await tool.handler({});
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("returns scenario metadata for bench.describe_target", async () => {
    const tool = getTool("bench.describe_target");
    const result = (await tool.handler({ targetId: "todo-react" })) as {
      scenarios: unknown[];
      benchmark: {
        capabilities: unknown[];
      };
    };

    expect(result.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: "smoke-load"
        })
      ])
    );
    expect(result.benchmark.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioIds: expect.arrayContaining(["smoke-load"])
        })
      ])
    );
  });
});
