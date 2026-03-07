import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  it("loads yaml and marks unavailable models when env key is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "registry-"));
    tempDirs.push(dir);
    const file = join(dir, "models.yaml");
    await writeFile(
      file,
      [
        "default_model: google/gemini-2.5-flash",
        "models:",
        "  - id: google/gemini-2.5-flash",
        "    provider: google",
        "    env_key: GEMINI_API_KEY",
        "    enabled: true",
        "  - id: openai/gpt-4o",
        "    provider: openai",
        "    env_key: OPENAI_API_KEY",
        "    enabled: true"
      ].join("\n"),
      "utf8"
    );

    const registry = await loadModelRegistry(file);
    const availability = resolveModelAvailability(registry, undefined, { GEMINI_API_KEY: "x" });

    expect(availability[0].available).toBe(true);
    expect(availability[1].available).toBe(false);
    expect(availability[1].reason).toContain("OPENAI_API_KEY");
  });
});

