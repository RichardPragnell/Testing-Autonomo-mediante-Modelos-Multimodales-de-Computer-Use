import { describe, expect, it } from "vitest";
import { extractUnifiedDiff } from "../../src/self-heal/adapter.js";

describe("self-heal adapter", () => {
  it("extracts unified diff from raw output", () => {
    const diff = extractUnifiedDiff(
      [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-const value = 1;",
        "+const value = 2;"
      ].join("\n")
    );
    expect(diff).toContain("+++ b/src/app.ts");
  });

  it("returns undefined when output has no unified diff", () => {
    const diff = extractUnifiedDiff("No patch was generated.");
    expect(diff).toBeUndefined();
  });
});

