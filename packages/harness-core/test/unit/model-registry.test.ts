import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadModelRegistry, resolveModelAvailability } from "../../src/config/model-registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("model registry", () => {
  it("loads yaml and requires OPENROUTER_API_KEY for model availability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "registry-"));
    tempDirs.push(dir);
    const file = join(dir, "models.yaml");
    await writeFile(
      file,
      [
        "default_model: mistralai/mistral-small-3.2-24b-instruct",
        "models:",
        "  - id: mistralai/mistral-small-3.2-24b-instruct",
        "    provider: mistralai",
        "    enabled: true",
        "  - id: openrouter/free",
        "    provider: openrouter",
        "    enabled: false",
        "  - id: google/gemini-2.5-flash-lite",
        "    provider: google",
        "    enabled: true"
      ].join("\n"),
      "utf8"
    );

    const registry = await loadModelRegistry(file);
    const unavailable = resolveModelAvailability(registry, undefined, {});
    const available = resolveModelAvailability(registry, undefined, { OPENROUTER_API_KEY: "x" });

    expect(unavailable[0].available).toBe(false);
    expect(unavailable[0].reason).toContain("OPENROUTER_API_KEY");
    expect(unavailable[1].available).toBe(false);
    expect(unavailable[1].reason).toContain("disabled");
    expect(available[0].available).toBe(true);
    expect(available[1].available).toBe(false);
    expect(available[1].reason).toContain("disabled");
    expect(available[2].available).toBe(true);
  });

  it("ships the refreshed default registry with cheap computer-use defaults and disabled dev models", async () => {
    const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
    const registry = await loadModelRegistry(join(repoRoot, "experiments", "models", "registry.yaml"));

    expect(registry.defaultModel).toBe("mistralai/mistral-small-3.2-24b-instruct");
    expect(registry.models.filter((model) => model.enabled).map((model) => model.id)).toEqual([
      "mistralai/mistral-small-3.2-24b-instruct",
      "qwen/qwen3.5-flash-02-23",
      "google/gemini-2.5-flash-lite"
    ]);
    expect(registry.models.filter((model) => !model.enabled).map((model) => model.id)).toEqual([
      "google/gemini-3-flash-preview",
      "moonshotai/kimi-k2.5",
      "openrouter/free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "google/gemma-3n-e2b-it:free"
    ]);
  });
});
