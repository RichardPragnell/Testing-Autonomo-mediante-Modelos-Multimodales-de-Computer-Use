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
    const explicitlyRequestedDisabled = resolveModelAvailability(registry, ["openrouter/free"], {
      OPENROUTER_API_KEY: "x"
    });

    expect(unavailable[0].available).toBe(false);
    expect(unavailable[0].reason).toContain("OPENROUTER_API_KEY");
    expect(unavailable[1].available).toBe(false);
    expect(unavailable[1].reason).toContain("OPENROUTER_API_KEY");
    expect(available[0].available).toBe(true);
    expect(available[1].available).toBe(true);
    expect(available.map((model) => model.id)).toEqual([
      "mistralai/mistral-small-3.2-24b-instruct",
      "google/gemini-2.5-flash-lite"
    ]);
    expect(explicitlyRequestedDisabled[0].available).toBe(false);
    expect(explicitlyRequestedDisabled[0].reason).toContain("disabled");
  });

  it("loads all enabled models from the checked-in yaml without a fallback selector", async () => {
    const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
    const registry = await loadModelRegistry(join(repoRoot, "experiments", "models", "registry.yaml"));

    expect(Object.keys(registry)).toEqual(["models"]);
    expect(registry.models.filter((model) => model.enabled).map((model) => model.id)).toEqual([
      "deepseek/deepseek-v3.2",
      "google/gemini-3.1-flash-lite-preview",
      "moonshotai/kimi-k2.5",
      "openai/gpt-5.4",
      "openai/gpt-5.4-nano",
      "mistralai/mistral-medium-3",
      "anthropic/claude-sonnet-4.6",
      "z-ai/glm-5.1"
    ]);
    expect(registry.models.filter((model) => !model.enabled).map((model) => model.id)).toEqual([]);
  });
});
