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
  it("loads yaml and requires OPENROUTER_API_KEY for model availability", async () => {
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
        "    enabled: true",
        "  - id: openai/gpt-4o",
        "    provider: openai",
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
    expect(unavailable[1].reason).toContain("OPENROUTER_API_KEY");
    expect(available[0].available).toBe(true);
    expect(available[1].available).toBe(true);
  });
});
