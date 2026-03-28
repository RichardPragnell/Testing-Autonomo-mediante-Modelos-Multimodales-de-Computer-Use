import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

describe("todo benchmark contract parity", () => {
  it("keeps the todo-react benchmark manifests aligned with the canonical todo-web contract", async () => {
    const root = process.cwd();
    const contract = await readJson<any>(join(root, "..", "..", "specs", "todo-web", "contract.json"));
    const benchmark = await readJson<any>(join(root, "..", "..", "apps", "todo-react", "benchmark.json"));
    const smokeScenario = await readJson<any>(join(root, "..", "..", "apps", "todo-react", "scenarios", "smoke.json"));
    const guidedScenario = await readJson<any>(join(root, "..", "..", "apps", "todo-react", "scenarios", "guided.json"));

    expect(smokeScenario).toEqual(contract.scenarios.smoke);
    expect(guidedScenario).toEqual(contract.scenarios.guided);
    expect(benchmark.capabilities).toEqual(contract.benchmark.capabilities);
    expect(benchmark.qa).toEqual(contract.benchmark.qa);
    expect(benchmark.explore).toEqual({
      capabilityIds: contract.benchmark.explore.capabilityIds,
      probeTaskIds: contract.benchmark.explore.probeTaskIds,
      heuristicTargets: contract.benchmark.explore.heuristicTargets
    });
    expect(benchmark.heal).toEqual(contract.benchmark.heal);
  });

  it("keeps the todo-react bug manifests aligned with the canonical bug pack contract", async () => {
    const root = process.cwd();
    const contract = await readJson<any>(join(root, "..", "..", "specs", "todo-web", "contract.json"));

    for (const bug of contract.bugPacks) {
      const manifest = await readJson<any>(join(root, "..", "..", "apps", "todo-react", "bugs", bug.bugId, "bug.json"));
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

  it("keeps the todo-react template copy, seed data, and automation hooks aligned with the contract", async () => {
    const root = process.cwd();
    const contract = await readJson<any>(join(root, "..", "..", "specs", "todo-web", "contract.json"));
    const indexHtml = await readFile(join(root, "..", "..", "apps", "todo-react", "template", "index.html"), "utf8");
    const appSource = await readFile(join(root, "..", "..", "apps", "todo-react", "template", "src", "App.jsx"), "utf8");
    const storeSource = await readFile(join(root, "..", "..", "apps", "todo-react", "template", "src", "todo-store.js"), "utf8");

    expect(indexHtml).toContain(`<title>${contract.ui.documentTitle}</title>`);
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
  });
});
