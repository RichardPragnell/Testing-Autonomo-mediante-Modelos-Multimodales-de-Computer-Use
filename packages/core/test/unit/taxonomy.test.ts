import { describe, expect, it } from "vitest";
import { classifyFailure } from "../../src/diagnostics/taxonomy.js";

describe("failure taxonomy", () => {
  it("categorizes locator failures", () => {
    expect(classifyFailure("element not found for selector #submit")).toBe("locator");
  });

  it("categorizes timeout failures", () => {
    expect(classifyFailure("operation timed out after 30s")).toBe("timeout");
  });
});

