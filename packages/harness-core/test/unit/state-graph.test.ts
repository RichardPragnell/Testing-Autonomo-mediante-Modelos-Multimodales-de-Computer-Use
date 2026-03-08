import { describe, expect, it } from "vitest";
import { CoverageGraph, fingerprintState } from "../../src/graph/state-graph.js";

describe("state graph", () => {
  it("produces deterministic fingerprint for equivalent state", () => {
    const first = fingerprintState({
      url: "http://localhost:3000",
      domSnapshot: "<html> <body><h1>Item 123</h1></body></html>",
      screenshotBase64: "abc"
    });
    const second = fingerprintState({
      url: "http://localhost:3000",
      domSnapshot: "<html><body><h1>Item 999</h1></body></html>",
      screenshotBase64: "abc"
    });

    expect(first.domHash).toBe(second.domHash);
  });

  it("prefers less-visited frontier nodes", () => {
    const graph = new CoverageGraph();
    const idA = graph.upsertState({ url: "http://a" });
    const idB = graph.upsertState({ url: "http://b" });
    graph.upsertState({ url: "http://a" });
    const next = graph.pickNovelFrontier([idA, idB]);
    expect(next).toBe(idB);
  });
});

