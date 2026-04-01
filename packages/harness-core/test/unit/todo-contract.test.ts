import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

const todoApps = [
  {
    appId: "todo-react",
    sourcePath: ["template", "src", "App.jsx"],
    seedPath: ["template", "src", "todo-store.js"],
    titlePath: ["template", "index.html"],
    expectedGoldTouchedFiles: ["src/todo-store.js"]
  },
  {
    appId: "todo-nextjs",
    sourcePath: ["template", "app", "page.js"],
    seedPath: ["template", "app", "todo-store.js"],
    titlePath: ["template", "app", "layout.js"],
    expectedGoldTouchedFiles: ["app/todo-store.js"]
  },
  {
    appId: "todo-angular",
    sourcePath: ["template", "src", "app", "app.component.ts"],
    seedPath: ["template", "src", "app", "todo-store.ts"],
    titlePath: ["template", "src", "index.html"],
    expectedGoldTouchedFiles: ["src/app/todo-store.ts"]
  }
] as const;

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("todo benchmark contract parity", () => {
  it.each(todoApps)("keeps $appId benchmark manifests aligned with the canonical todo-web contract", async ({
    appId,
    expectedGoldTouchedFiles
  }) => {
    const contract = await readJson<any>(join(repoRoot, "specs", "todo-web", "contract.json"));
    const benchmark = await readJson<any>(join(repoRoot, "apps", appId, "benchmark.json"));
    const smokeScenario = await readJson<any>(join(repoRoot, "apps", appId, "scenarios", "smoke.json"));
    const guidedScenario = await readJson<any>(join(repoRoot, "apps", appId, "scenarios", "guided.json"));

    expect(smokeScenario).toEqual(contract.scenarios.smoke);
    expect(guidedScenario).toEqual(contract.scenarios.guided);
    expect(benchmark.capabilities).toEqual(contract.benchmark.capabilities);
    expect(benchmark.qa).toEqual(contract.benchmark.qa);
    expect(benchmark.explore).toEqual({
      capabilityIds: contract.benchmark.explore.capabilityIds,
      probeTaskIds: contract.benchmark.explore.probeTaskIds,
      heuristicTargets: contract.benchmark.explore.heuristicTargets
    });
    expect(benchmark.heal.caseIds).toEqual(contract.benchmark.heal.caseIds);
    expect(benchmark.heal.cases).toEqual(
      contract.benchmark.heal.cases.map((candidate: any) => ({
        ...candidate,
        goldTouchedFiles: expectedGoldTouchedFiles
      }))
    );
  });

  it.each(todoApps)("keeps $appId bug manifests aligned with the canonical bug pack contract", async ({ appId }) => {
    const contract = await readJson<any>(join(repoRoot, "specs", "todo-web", "contract.json"));

    for (const bug of contract.bugPacks) {
      const manifest = await readJson<any>(join(repoRoot, "apps", appId, "bugs", bug.bugId, "bug.json"));
      expect(manifest).toEqual({
        bugId: bug.bugId,
        title: bug.title,
        description: bug.description,
        category: bug.category,
        severity: bug.severity,
        patchPath: bug.patchPath,
        expectedFailureTaskIds: bug.expectedFailureTaskIds
      });
    }
  });

  it.each(todoApps)(
    "keeps $appId template copy, seed data, and automation hooks aligned with the contract",
    async ({ appId, sourcePath, seedPath, titlePath }) => {
      const contract = await readJson<any>(join(repoRoot, "specs", "todo-web", "contract.json"));
      const titleSource = await readFile(join(repoRoot, "apps", appId, ...titlePath), "utf8");
      const appSource = await readFile(join(repoRoot, "apps", appId, ...sourcePath), "utf8");
      const storeSource = await readFile(join(repoRoot, "apps", appId, ...seedPath), "utf8");

      expect(titleSource).toContain(contract.ui.documentTitle);
      expect(appSource).toContain(contract.ui.pageHeading);
      expect(appSource).toContain(contract.ui.heroLead);
      expect(appSource).toContain(contract.ui.newTaskPlaceholder);
      expect(appSource).toContain(contract.ui.listAriaLabel);
      expect(storeSource).toContain(contract.seed.initialTodos[0].text);
      expect(storeSource).toContain(contract.seed.initialTodos[1].text);

      for (const hook of contract.automationHooks.requiredAttributes) {
        if (hook.value) {
          expect(appSource).toContain(`${hook.attribute}="${hook.value}"`);
        }
        if (hook.valueSet) {
          expect(appSource).toContain(hook.attribute);
          for (const value of hook.valueSet) {
            expect(appSource).toContain(value);
          }
        }
        if (hook.dynamic) {
          expect(appSource).toContain(hook.attribute);
        }
      }
    }
  );
});
