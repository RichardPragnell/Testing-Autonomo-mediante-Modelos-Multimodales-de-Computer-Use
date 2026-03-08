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
  it("registers required benchmark tools", () => {
    const names = toolContracts.map((tool) => tool.name);
    expect(names).toContain("bench.run_suite");
    expect(names).toContain("bench.get_report");
    expect(names).toContain("bench.compare_runs");
    expect(names).toContain("bench.run_self_heal");
    expect(names).toContain("bench.list_targets");
    expect(names).toContain("bench.list_suites");
    expect(names).toContain("bench.describe_target");
  });

  it("enforces input schema for bench.describe_target", () => {
    const tool = toolContracts.find((item) => item.name === "bench.describe_target");
    expect(tool).toBeDefined();
    expect(() => z.object(tool!.inputSchema).parse({})).toThrow();
  });

  it("keeps bench.list_targets idempotent for repeated reads", async () => {
    const tool = toolContracts.find((item) => item.name === "bench.list_targets");
    expect(tool).toBeDefined();
    const first = await tool!.handler({});
    const second = await tool!.handler({});
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
