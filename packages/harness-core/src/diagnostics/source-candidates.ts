import { join } from "node:path";
import type {
  BenchmarkTask,
  FailureCategory,
  ResolvedBenchmarkSuite,
  SourceCandidate,
  TaskRunResult
} from "../types.js";

type RouteHint = "incidents" | "overview" | "releases" | "settings";

interface CandidateState {
  path: string;
  workspaceRelativePath: string;
  score: number;
  reasons: Set<string>;
}

const routeFiles: Record<RouteHint, Array<{ path: string; score: number; reason: string }>> = {
  overview: [
    { path: "public/app.js", score: 20, reason: "route hint points to the overview shell controller" },
    { path: "public/modules/ui/render.js", score: 24, reason: "route hint points to overview rendering" }
  ],
  incidents: [
    { path: "public/modules/domain/incidents.js", score: 34, reason: "route hint points to incident filtering logic" },
    { path: "public/modules/ui/render.js", score: 26, reason: "route hint points to incident board rendering" },
    { path: "public/app.js", score: 18, reason: "route hint points to the incident route controller" }
  ],
  releases: [
    { path: "public/modules/domain/releases.js", score: 34, reason: "route hint points to release summary logic" },
    { path: "public/modules/ui/render.js", score: 24, reason: "route hint points to release rendering" },
    { path: "public/app.js", score: 18, reason: "route hint points to the release route controller" }
  ],
  settings: [
    { path: "public/modules/state/preferences.js", score: 34, reason: "route hint points to preference state logic" },
    { path: "public/modules/ui/render.js", score: 24, reason: "route hint points to toast and settings rendering" },
    { path: "public/app.js", score: 22, reason: "route hint points to settings event wiring" }
  ]
};

const categoryFiles: Record<FailureCategory, Array<{ path: string; score: number; reason: string }>> = {
  assertion: [
    { path: "public/modules/ui/render.js", score: 22, reason: "assertion failures often surface in rendered text" },
    { path: "public/app.js", score: 12, reason: "assertion failures can come from route-state wiring" }
  ],
  locator: [
    { path: "public/modules/ui/render.js", score: 30, reason: "locator failures usually come from missing or changed markup" },
    { path: "public/app.js", score: 16, reason: "locator failures can come from event wiring or route transitions" }
  ],
  navigation: [
    { path: "public/app.js", score: 26, reason: "navigation failures often come from route handling" },
    { path: "src/server.mjs", score: 18, reason: "navigation failures can come from AUT bootstrap or static serving" }
  ],
  state: [
    { path: "public/app.js", score: 14, reason: "state failures can come from client-side state transitions" }
  ],
  timeout: [
    { path: "public/app.js", score: 18, reason: "timeouts can come from stuck client-side transitions" },
    { path: "public/modules/ui/render.js", score: 12, reason: "timeouts can come from render loops or hidden UI waits" },
    { path: "src/server.mjs", score: 10, reason: "timeouts can come from AUT startup or response issues" }
  ],
  unexpected_ui: [
    { path: "public/modules/ui/render.js", score: 30, reason: "unexpected UI usually comes from toast, modal, or conditional rendering" },
    { path: "public/app.js", score: 16, reason: "unexpected UI can be triggered by incorrect client-side events" }
  ],
  unknown: [{ path: "public/app.js", score: 8, reason: "fallback candidate from the shared app shell" }]
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

  if (/(settings|preferences|execution mode|save preferences|preferences saved)/u.test(haystack)) {
    return "settings";
  }
  if (/(incidents|incident board|critical incidents|active incidents|critical only|open only|payments)/u.test(haystack)) {
    return "incidents";
  }
  if (/(releases|release checklist|blocked train|data-contract mismatch|monitoring)/u.test(haystack)) {
    return "releases";
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

  for (const hint of routeFiles[routeHint]) {
    addCandidate(candidates, input.workspacePath, hint.path, hint.score, hint.reason);
  }

  for (const hint of categoryFiles[input.category]) {
    addCandidate(candidates, input.workspacePath, hint.path, hint.score, hint.reason);
  }

  if (routeHint === "incidents" && input.category === "state") {
    addCandidate(
      candidates,
      input.workspacePath,
      "public/modules/domain/incidents.js",
      24,
      "state failure inside the incidents route often originates in filter or summary helpers"
    );
  }

  if (routeHint === "releases" && input.category === "state") {
    addCandidate(
      candidates,
      input.workspacePath,
      "public/modules/domain/releases.js",
      24,
      "state failure inside the releases route often originates in release summary helpers"
    );
  }

  if (routeHint === "settings" && (input.category === "state" || input.category === "unexpected_ui")) {
    addCandidate(
      candidates,
      input.workspacePath,
      "public/modules/state/preferences.js",
      24,
      "settings failures often originate in preference state serialization"
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
