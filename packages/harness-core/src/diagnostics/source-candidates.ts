import { join } from "node:path";
import type {
  BenchmarkTask,
  FailureCategory,
  ResolvedBenchmarkSuite,
  SourceCandidate,
  TaskRunResult
} from "../types.js";

type RouteHint = "composer" | "filter" | "editor" | "overview";

interface CandidateState {
  path: string;
  workspaceRelativePath: string;
  score: number;
  reasons: Set<string>;
}

const routeFiles: Record<RouteHint, Array<{ path: string; score: number; reason: string }>> = {
  overview: [
    { path: "src/App.jsx", score: 24, reason: "overview hint points to the main React app shell" },
    { path: "src/todo-store.js", score: 20, reason: "overview hint points to shared todo state helpers" }
  ],
  composer: [
    { path: "src/todo-store.js", score: 34, reason: "composer hint points to todo creation logic" },
    { path: "src/App.jsx", score: 26, reason: "composer hint points to form wiring and rendering" }
  ],
  filter: [
    { path: "src/todo-store.js", score: 34, reason: "filter hint points to todo filtering and completion logic" },
    { path: "src/App.jsx", score: 24, reason: "filter hint points to filter controls and list rendering" }
  ],
  editor: [
    { path: "src/todo-store.js", score: 32, reason: "editor hint points to todo update logic" },
    { path: "src/App.jsx", score: 28, reason: "editor hint points to edit controls and save or cancel wiring" }
  ]
};

const categoryFiles: Record<FailureCategory, Array<{ path: string; score: number; reason: string }>> = {
  assertion: [
    { path: "src/App.jsx", score: 22, reason: "assertion failures often surface in rendered React output" },
    { path: "src/todo-store.js", score: 12, reason: "assertion failures can come from incorrect todo state helpers" }
  ],
  locator: [
    { path: "src/App.jsx", score: 30, reason: "locator failures usually come from changed JSX or missing elements" },
    { path: "src/main.jsx", score: 12, reason: "locator failures can come from incorrect app bootstrap" }
  ],
  navigation: [
    { path: "src/main.jsx", score: 22, reason: "navigation failures can come from broken React bootstrap" },
    { path: "src/App.jsx", score: 16, reason: "navigation failures can come from top-level app rendering" }
  ],
  state: [
    { path: "src/todo-store.js", score: 24, reason: "state failures often originate in todo mutation helpers" },
    { path: "src/App.jsx", score: 14, reason: "state failures can come from React event wiring" }
  ],
  timeout: [
    { path: "src/App.jsx", score: 18, reason: "timeouts can come from render loops or stalled UI updates" },
    { path: "src/main.jsx", score: 12, reason: "timeouts can come from app startup issues" }
  ],
  unexpected_ui: [
    { path: "src/App.jsx", score: 30, reason: "unexpected UI usually comes from conditional JSX or list rendering" },
    { path: "src/todo-store.js", score: 16, reason: "unexpected UI can be triggered by incorrect todo state values" }
  ],
  unknown: [{ path: "src/App.jsx", score: 8, reason: "fallback candidate from the shared app shell" }]
};

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function collectTraceText(result: TaskRunResult): string[] {
  const values: string[] = [];
  for (const entry of result.trace) {
    values.push(entry.action);
    if (entry.details) {
      for (const value of Object.values(entry.details)) {
        values.push(String(value));
      }
    }
  }
  return values;
}

function detectRouteHint(values: string[]): RouteHint {
  const haystack = values.join(" ").toLowerCase();

  if (/(add task|new task|composer|review benchmark notes)/u.test(haystack)) {
    return "composer";
  }
  if (/(edit|save|cancel|outline|rename|updated text)/u.test(haystack)) {
    return "editor";
  }
  if (/(active filter|completed task|tasks done|remaining|draft stagehand checklist|plan react todo benchmark)/u.test(haystack)) {
    return "filter";
  }
  return "overview";
}

function addCandidate(
  state: Map<string, CandidateState>,
  workspacePath: string,
  relativePath: string,
  score: number,
  reason: string
): void {
  const workspaceRelativePath = normalizeRelativePath(relativePath);
  const existing = state.get(workspaceRelativePath);
  if (existing) {
    existing.score += score;
    existing.reasons.add(reason);
    return;
  }

  state.set(workspaceRelativePath, {
    path: join(workspacePath, ...workspaceRelativePath.split("/")),
    workspaceRelativePath,
    score,
    reasons: new Set([reason])
  });
}

export function buildSourceCandidates(input: {
  workspacePath: string;
  suite: ResolvedBenchmarkSuite;
  task: BenchmarkTask;
  result: TaskRunResult;
  category: FailureCategory;
  message: string;
  includeBugHints?: boolean;
}): SourceCandidate[] {
  const candidates = new Map<string, CandidateState>();
  const routeHint = detectRouteHint([
    input.task.id,
    input.task.instruction,
    input.task.expected.value,
    input.result.urlAfter ?? "",
    input.message,
    input.result.domSnapshot ?? "",
    ...collectTraceText(input.result)
  ]);

  if (input.includeBugHints ?? true) {
    for (const bug of input.suite.selectedBugs) {
      if (!bug.expectedFailureTaskIds.includes(input.task.id)) {
        continue;
      }
      for (const touchedFile of bug.touchedFiles) {
        addCandidate(
          candidates,
          input.workspacePath,
          touchedFile,
          90,
          `bug pack ${bug.bugId} is expected to fail on task ${input.task.id}`
        );
      }
    }
  }

  for (const hint of routeFiles[routeHint]) {
    addCandidate(candidates, input.workspacePath, hint.path, hint.score, hint.reason);
  }

  for (const hint of categoryFiles[input.category]) {
    addCandidate(candidates, input.workspacePath, hint.path, hint.score, hint.reason);
  }

  if (routeHint === "filter" && input.category === "state") {
    addCandidate(
      candidates,
      input.workspacePath,
      "src/todo-store.js",
      24,
      "filter state failures often originate in todo toggle or filtering helpers"
    );
  }

  if (routeHint === "composer" && input.category === "assertion") {
    addCandidate(
      candidates,
      input.workspacePath,
      "src/todo-store.js",
      24,
      "composer assertion failures often originate in todo creation helpers"
    );
  }

  return [...candidates.values()]
    .map((candidate) => ({
      path: candidate.path,
      workspaceRelativePath: candidate.workspaceRelativePath,
      score: candidate.score,
      reasons: [...candidate.reasons].sort()
    }))
    .sort((left, right) => right.score - left.score || left.workspaceRelativePath.localeCompare(right.workspaceRelativePath))
    .slice(0, 5);
}
