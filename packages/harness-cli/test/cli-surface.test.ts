import { describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

function helpFor(program = createProgram(undefined)): string {
  return program.helpInformation();
}

function helpForCommand(name: string): string {
  const program = createProgram(undefined);
  const command = program.commands.find((candidate) => candidate.name() === name);
  expect(command).toBeDefined();
  if (!command) {
    throw new Error(`Missing command ${name}`);
  }
  return command.helpInformation();
}

describe("CLI surface", () => {
  it("shows the benchmark mode commands plus report rebuild at the top level", () => {
    const stdout = helpFor();

    expect(stdout).toContain("guided");
    expect(stdout).toContain("explore");
    expect(stdout).toContain("heal");
    expect(stdout).toContain("fullbench");
    expect(stdout).toContain("report");
    expect(stdout).not.toContain("suite");
    expect(stdout).not.toContain("compare");
  });

  it("uses optional app arguments for guided, explore, and heal and exposes report rebuild help", () => {
    const guidedHelp = helpForCommand("guided");
    const exploreHelp = helpForCommand("explore");
    const healHelp = helpForCommand("heal");
    const fullbenchHelp = helpForCommand("fullbench");
    const reportHelp = helpForCommand("report");

    expect(guidedHelp).toContain("guided [options] [app]");
    expect(guidedHelp).toContain("--models <ids...>");
    expect(guidedHelp).toContain("--trials <n>");
    expect(guidedHelp).toContain("--parallelism <n>");
    expect(guidedHelp).toContain("--app-parallelism <n>");
    expect(guidedHelp).toContain("--max-steps <n>");
    expect(guidedHelp).toContain("--timeout-ms <n>");
    expect(guidedHelp).toContain("--max-output-tokens <n>");
    expect(guidedHelp).not.toContain("--profile <profile>");
    expect(guidedHelp).not.toContain("--app <");
    expect(guidedHelp).not.toContain("--models-path");
    expect(guidedHelp).not.toContain("--results-dir");
    expect(guidedHelp).not.toContain("--preset");

    expect(exploreHelp).toContain("explore [options] [app]");
    expect(exploreHelp).toContain("--parallelism <n>");
    expect(exploreHelp).toContain("--app-parallelism <n>");
    expect(healHelp).toContain("heal [options] [app]");
    expect(healHelp).toContain("--parallelism <n>");
    expect(healHelp).toContain("--app-parallelism <n>");
    expect(fullbenchHelp).toContain("fullbench [options]");
    expect(fullbenchHelp).toContain("--parallel <n>");
    expect(fullbenchHelp).toContain("--parallelism <n>");
    expect(fullbenchHelp).toContain("--app-parallelism <n>");
    expect(fullbenchHelp).toContain("--html-scope <scope>");
    expect(fullbenchHelp).toContain("--skip-existing");
    expect(reportHelp).toContain("report [options] [mode]");
    expect(reportHelp).toContain("guided, explore, or heal");
    expect(reportHelp).toContain("--html-scope <scope>");
    expect(reportHelp).toContain("compare (default) or all");
  });
});
