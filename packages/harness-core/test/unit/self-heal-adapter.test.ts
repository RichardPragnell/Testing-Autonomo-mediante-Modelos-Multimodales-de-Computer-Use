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

  it("extracts only the diff block when output includes surrounding chatter", () => {
    const diff = extractUnifiedDiff(
      [
        "Here is the fix.",
        "",
        "```diff",
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        '-const label = "before";',
        '+const label = "after";',
        "```",
        "",
        "{\"notes\":\"applies cleanly\"}"
      ].join("\n")
    );

    expect(diff).toBe(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        '-const label = "before";',
        '+const label = "after";',
        ""
      ].join("\n")
    );
  });

  it("returns undefined when output has no unified diff", () => {
    const diff = extractUnifiedDiff("No patch was generated.");
    expect(diff).toBeUndefined();
  });
});
