import { describe, expect, it } from "vitest";
import {
  buildActionCacheEntries,
  matchActionCache,
  mergeActionCache,
  resolveExplorationCompatibility
} from "../../src/exploration/action-cache.js";

describe("action cache", () => {
  it("deduplicates identical observed actions", () => {
    const first = buildActionCacheEntries({
      stateId: "state-root",
      url: "http://127.0.0.1:3101",
      domHash: "dom-1",
      visualHash: "visual-1",
      actions: [
        {
          selector: "button:text(Edit)",
          description: "Edit button for the first todo",
          method: "click",
          arguments: []
        }
      ],
      instructionHint: "Edit an existing todo item"
    });

    const second = buildActionCacheEntries({
      stateId: "state-root",
      url: "http://127.0.0.1:3101",
      domHash: "dom-1",
      visualHash: "visual-1",
      actions: [
        {
          selector: "button:text(Edit)",
          description: "Edit button for the first todo",
          method: "click",
          arguments: []
        }
      ],
      instructionHint: "Rename the first todo"
    });

    const merged = mergeActionCache(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.instructionHints).toContain("Rename the first todo");
    expect(merged[0]?.observationCount).toBe(2);
  });

  it("matches cached actions by state and intent", () => {
    const cache = buildActionCacheEntries({
      stateId: "state-root",
      url: "http://127.0.0.1:3101",
      domHash: "dom-1",
      visualHash: "visual-1",
      actions: [
        {
          selector: "button:text(Edit)",
          description: "Edit button for the first todo",
          method: "click",
          arguments: []
        },
        {
          selector: "button:text(Remove)",
          description: "Remove button for the selected todo",
          method: "click",
          arguments: []
        }
      ],
      instructionHint: "Edit an existing todo item"
    });

    const matches = matchActionCache({
      cache,
      instruction: "Edit an existing todo item",
      stateId: "state-root",
      limit: 1
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.description).toContain("Edit button");
  });

  it("rejects incompatible exploration artifacts", () => {
    const compatibility = resolveExplorationCompatibility({
      artifact: {
        explorationRunId: "explore-1",
        targetId: "todo-react",
        bugIds: ["toggle-completion-noop"],
        modelId: "mock/model",
        trial: 1,
        prompt: "Explore",
        workspacePath: "/tmp/workspace",
        startedAt: "2026-03-08T00:00:00.000Z",
        finishedAt: "2026-03-08T00:00:01.000Z",
        compatibility: {
          targetId: "todo-react",
          bugIds: ["toggle-completion-noop"],
          viewport: { width: 1280, height: 720 }
        },
        history: [],
        pages: [],
        coverageGraph: { nodes: [], edges: [] },
        actionCache: [],
        trace: [],
        summary: {
          statesDiscovered: 0,
          transitionsDiscovered: 0,
          actionsCached: 0,
          historyEntries: 0
        }
      },
      targetId: "todo-react",
      bugIds: [],
      viewport: { width: 1280, height: 720 }
    });

    expect(compatibility.compatible).toBe(false);
    expect(compatibility.reason).toContain("bug mismatch");
  });
});
