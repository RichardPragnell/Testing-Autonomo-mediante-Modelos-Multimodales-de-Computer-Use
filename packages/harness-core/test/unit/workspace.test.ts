import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRunWorkspace } from "../../src/runtime/workspace.js";
import type { ResolvedBenchmarkSuite } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createOccupiedPortServer(): Promise<{
  host: string;
  port: number;
  close: () => Promise<void>;
}> {
  const host = "127.0.0.1";
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP server address");
  }

  return {
    host,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

async function createResolvedSuite(baseUrl: string, templatePath: string): Promise<ResolvedBenchmarkSuite> {
  return {
    suitePath: join(templatePath, "..", "benchmark.json"),
    suite: {
      suiteId: "workspace-port-test",
      targetId: "test-target",
      scenarioIds: [],
      bugIds: [],
      explorationMode: "guided",
      trials: 1,
      timeoutMs: 1_000,
      retryCount: 0,
      maxSteps: 1,
      viewport: {
        width: 1280,
        height: 720
      },
      seed: 1,
      resultsDir: "results"
    },
    target: {
      manifestPath: join(templatePath, "..", "target.json"),
      rootDir: join(templatePath, ".."),
      templatePath,
      target: {
        targetId: "test-target",
        displayName: "Test Target",
        baseUrl,
        devCommand: 'node server.js --host {{autHost}} --port {{autPort}} --workspace "{{workspacePath}}"',
        devEnv: {
          PORT: "{{autPort}}",
          HOST: "{{autHost}}",
          BASE_URL: "{{autBaseUrl}}"
        },
        defaultValidationCommand: 'echo "{{autPort}}"',
        templateDir: "template",
        bugsDir: "bugs",
        scenariosDir: "scenarios"
      },
      scenarios: [],
      bugs: []
    },
    selectedScenarios: [],
    selectedBugs: [],
    tasks: [],
    prompts: {}
  };
}

describe("prepareRunWorkspace", () => {
  it("allocates a free AUT port and resolves command and env placeholders when the preferred port is occupied", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-port-"));
    tempDirs.push(root);
    const templatePath = join(root, "template");
    await mkdir(templatePath, { recursive: true });
    await writeFile(join(templatePath, "README.md"), "# template\n", "utf8");

    const occupied = await createOccupiedPortServer();
    try {
      const resultsDir = join(root, "results");
      const suite = await createResolvedSuite(`http://${occupied.host}:${occupied.port}`, templatePath);
      const workspace = await prepareRunWorkspace({
        resolvedSuite: suite,
        runId: "qa-test-run",
        resultsRoot: resultsDir
      });

      const selectedPort = Number.parseInt(new URL(workspace.aut.url).port, 10);
      expect(selectedPort).not.toBe(occupied.port);
      expect(workspace.aut.url).toBe(`http://${occupied.host}:${selectedPort}`);
      expect(workspace.aut.command).toContain(`--port ${selectedPort}`);
      expect(workspace.aut.command).toContain(`--host ${occupied.host}`);
      expect(workspace.aut.env?.PORT).toBe(String(selectedPort));
      expect(workspace.aut.env?.HOST).toBe(occupied.host);
      expect(workspace.aut.env?.BASE_URL).toBe(workspace.aut.url);
      expect(workspace.validationCommand).toBe(`echo "${selectedPort}"`);
      await expect(readFile(join(workspace.workspacePath, "README.md"), "utf8")).resolves.toContain("# template");
    } finally {
      await occupied.close();
    }
  });
});
