import { join } from "node:path";
import type {
  BenchmarkScenario,
  FailureCategory,
  ResolvedBenchmarkSuite,
  SourceCandidate,
  ScenarioRunResult
} from "../types.js";

type RouteHint = "composer" | "filter" | "editor" | "overview";

type AppShape = "react" | "nextjs" | "angular";

interface CandidateState {
  path: string;
  workspaceRelativePath: string;
  score: number;
  reasons: Set<string>;
}

const appShapeFiles: Record<
  AppShape,
  {
    shell: string;
    store: string;
    bootstrap: string;
    editor: string;
    shellLabel: string;
    storeLabel: string;
    bootstrapLabel: string;
  }
> = {
  react: {
    shell: "src/App.jsx",
    store: "src/todo-store.js",
    bootstrap: "src/main.jsx",
    editor: "src/todo-editor.js",
    shellLabel: "main React app shell",
    storeLabel: "shared todo state helpers",
    bootstrapLabel: "React app bootstrap"
  },
  nextjs: {
    shell: "app/page.js",
    store: "app/todo-store.js",
    bootstrap: "app/layout.js",
    editor: "app/todo-editor.js",
    shellLabel: "main Next.js page component",
    storeLabel: "shared todo state helpers",
    bootstrapLabel: "Next.js app shell"
  },
  angular: {
    shell: "src/app/app.component.ts",
    store: "src/app/todo-store.ts",
    bootstrap: "src/main.ts",
    editor: "src/app/todo-editor.ts",
    shellLabel: "main Angular component with the inline template",
    storeLabel: "shared todo state helpers",
    bootstrapLabel: "Angular app bootstrap"
  }
};

const categoryLabels: Record<AppShape, Record<FailureCategory, string>> = {
  react: {
    assertion: "assertion failures often surface in rendered React output",
    locator: "locator failures usually come from changed JSX or missing elements",
    navigation: "navigation failures can come from broken React bootstrap",
    state: "state failures can come from React event wiring",
    timeout: "timeouts can come from render loops or stalled UI updates",
    unexpected_ui: "unexpected UI usually comes from conditional JSX or list rendering",
    unknown: "fallback candidate from the shared React app shell"
  },
  nextjs: {
    assertion: "assertion failures often surface in rendered Next.js page output",
    locator: "locator failures usually come from changed page markup or missing elements",
    navigation: "navigation failures can come from broken Next.js app shell or page wiring",
    state: "state failures can come from page event wiring",
    timeout: "timeouts can come from stalled client rendering or hydration issues",
    unexpected_ui: "unexpected UI usually comes from conditional page rendering",
    unknown: "fallback candidate from the shared Next.js page shell"
  },
  angular: {
    assertion: "assertion failures often surface in rendered Angular component output",
    locator: "locator failures usually come from changed Angular template markup or missing elements",
    navigation: "navigation failures can come from broken Angular bootstrap",
    state: "state failures can come from Angular event wiring",
    timeout: "timeouts can come from stalled Angular rendering or change detection",
    unexpected_ui: "unexpected UI usually comes from conditional Angular template rendering",
    unknown: "fallback candidate from the shared Angular component shell"
  }
};

function detectAppShape(suite: ResolvedBenchmarkSuite): AppShape {
  const targetId = suite.target.target.targetId.toLowerCase();
  if (targetId.includes("angular")) {
    return "angular";
  }
  if (targetId.includes("next")) {
    return "nextjs";
  }

  const touchedFiles = suite.selectedBugs.flatMap((bug) => bug.touchedFiles.map((file) => file.toLowerCase()));
  if (touchedFiles.some((file) => file.startsWith("src/app/") || file.endsWith(".ts"))) {
    return "angular";
  }
  if (touchedFiles.some((file) => file.startsWith("app/"))) {
    return "nextjs";
  }
  return "react";
}

function buildRouteFiles(appShape: AppShape): Record<RouteHint, Array<{ path: string; score: number; reason: string }>> {
  const files = appShapeFiles[appShape];
  return {
    overview: [
      { path: files.shell, score: 24, reason: `overview hint points to the ${files.shellLabel}` },
      { path: files.store, score: 20, reason: `overview hint points to ${files.storeLabel}` }
    ],
    composer: [
      { path: files.store, score: 34, reason: "composer hint points to todo creation logic" },
      { path: files.shell, score: 26, reason: "composer hint points to form wiring and rendering" }
    ],
    filter: [
      { path: files.store, score: 34, reason: "filter hint points to todo filtering and completion logic" },
      { path: files.shell, score: 24, reason: "filter hint points to filter controls and list rendering" }
    ],
    editor: [
      { path: files.store, score: 32, reason: "editor hint points to todo update logic" },
      { path: files.shell, score: 28, reason: "editor hint points to edit controls and save or cancel wiring" },
      { path: files.editor, score: 18, reason: "editor hint points to shared edit-state helpers" }
    ]
  };
}

function buildCategoryFiles(
  appShape: AppShape
): Record<FailureCategory, Array<{ path: string; score: number; reason: string }>> {
  const files = appShapeFiles[appShape];
  const labels = categoryLabels[appShape];

  return {
    assertion: [
      { path: files.shell, score: 22, reason: labels.assertion },
      { path: files.store, score: 12, reason: "assertion failures can come from incorrect todo state helpers" }
    ],
    locator: [
      { path: files.shell, score: 30, reason: labels.locator },
      { path: files.bootstrap, score: 12, reason: `${labels.locator} or broken ${files.bootstrapLabel.toLowerCase()}` }
    ],
    navigation: [
      { path: files.bootstrap, score: 22, reason: labels.navigation },
      { path: files.shell, score: 16, reason: `navigation failures can come from broken ${files.shellLabel}` }
    ],
    state: [
      { path: files.store, score: 24, reason: "state failures often originate in todo mutation helpers" },
      { path: files.shell, score: 14, reason: labels.state }
    ],
    timeout: [
      { path: files.shell, score: 18, reason: labels.timeout },
      { path: files.bootstrap, score: 12, reason: "timeouts can come from app startup issues" }
    ],
    unexpected_ui: [
      { path: files.shell, score: 30, reason: labels.unexpected_ui },
      { path: files.store, score: 16, reason: "unexpected UI can be triggered by incorrect todo state values" }
    ],
    unknown: [{ path: files.shell, score: 8, reason: labels.unknown }]
  };
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function collectTraceText(result: ScenarioRunResult): string[] {
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
  scenario: BenchmarkScenario;
  result: ScenarioRunResult;
  category: FailureCategory;
  message: string;
  includeBugHints?: boolean;
}): SourceCandidate[] {
  const candidates = new Map<string, CandidateState>();
  const appShape = detectAppShape(input.suite);
  const routeFiles = buildRouteFiles(appShape);
  const categoryFiles = buildCategoryFiles(appShape);
  const files = appShapeFiles[appShape];
  const failedStep = input.result.stepRuns.find((step) => !step.success);
  const failedAssertion = failedStep?.assertionRuns.find((assertion) => !assertion.success);
  const routeHint = detectRouteHint([
    input.scenario.scenarioId,
    input.scenario.title,
    ...(input.scenario.steps.map((step) => step.title)),
    failedStep?.title ?? "",
    failedAssertion?.message ?? "",
    input.result.urlAfter ?? "",
    input.message,
    input.result.domSnapshot ?? "",
    ...collectTraceText(input.result)
  ]);

  if (input.includeBugHints ?? true) {
    for (const bug of input.suite.selectedBugs) {
      if (!bug.expectedFailureScenarioIds.includes(input.scenario.scenarioId)) {
        continue;
      }
      for (const touchedFile of bug.touchedFiles) {
        addCandidate(
          candidates,
          input.workspacePath,
          touchedFile,
          90,
          `bug pack ${bug.bugId} is expected to fail on scenario ${input.scenario.scenarioId}`
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
      files.store,
      24,
      "filter state failures often originate in todo toggle or filtering helpers"
    );
  }

  if (routeHint === "composer" && input.category === "assertion") {
    addCandidate(
      candidates,
      input.workspacePath,
      files.store,
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
