import { generateText } from "ai";
import {
  buildOpenRouterUsageRecord,
  createOpenRouterLanguageModel,
  isOpenRouterCostTrackingEnabled
} from "../ai/openrouter.js";
import { summarizeAiUsage } from "../ai/usage.js";
import type { ModelAvailability } from "../types.js";
import type { RepairModelResult, RepairPromptContext, RepairUsage } from "../experiments/types.js";

export interface RepairModelClient {
  repair(input: {
    model: ModelAvailability;
    systemPrompt: string;
    context: RepairPromptContext;
  }): Promise<RepairModelResult>;
}

function extractJsonBlock(raw: string): string | undefined {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const generic = raw.match(/```([\s\S]*?)```/i);
  if (generic) {
    return generic[1].trim();
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1).trim();
  }
  return undefined;
}

function extractPatch(raw: string): string | undefined {
  const diffFence = raw.match(/```diff\s*([\s\S]*?)```/i);
  const candidate = diffFence?.[1]?.trim() ?? raw.trim();
  const hasMarkers =
    /(^|\n)---\s+.+/.test(candidate) &&
    /(^|\n)\+\+\+\s+.+/.test(candidate) &&
    /(^|\n)@@/.test(candidate);
  return hasMarkers ? `${candidate}\n` : undefined;
}

function parseRepairResult(raw: string, usage: RepairUsage): RepairModelResult {
  const jsonCandidate = extractJsonBlock(raw);
  let diagnosisSummary = "No diagnosis summary returned.";
  let suspectedFiles: string[] = [];
  let notes: string | undefined;
  let patch = extractPatch(raw);

  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as {
        diagnosisSummary?: string;
        suspectedFiles?: string[];
        notes?: string;
        patch?: string;
      };
      diagnosisSummary = parsed.diagnosisSummary?.trim() || diagnosisSummary;
      suspectedFiles = Array.isArray(parsed.suspectedFiles)
        ? parsed.suspectedFiles.map((item) => String(item))
        : suspectedFiles;
      notes = parsed.notes?.trim() || notes;
      if (parsed.patch && extractPatch(parsed.patch)) {
        patch = extractPatch(parsed.patch);
      }
    } catch {
      // ignore malformed JSON and fall back to diff extraction
    }
  }

  return {
    diagnosis: {
      summary: diagnosisSummary,
      suspectedFiles,
      notes
    },
    patch,
    usage,
    rawResponse: raw
  };
}

function formatRepairPrompt(context: RepairPromptContext): string {
  const findings = context.findings
    .map(
      (finding, index) => `Finding ${index + 1}
task: ${finding.taskId}
message: ${finding.message}
category: ${finding.category}
severity: ${finding.severity}`
    )
    .join("\n\n");

  const files = context.candidateFiles
    .map(
      (file, index) => `Candidate file ${index + 1}: ${file.path}
Reasons: ${file.reasons.join("; ")}
Content:
\`\`\`
${file.content}
\`\`\``
    )
    .join("\n\n");

  const traces = context.traces
    .slice(-24)
    .map((entry) => `${entry.timestamp} ${entry.action} ${entry.details ? JSON.stringify(entry.details) : ""}`.trim())
    .join("\n");

  return `You are repairing a benchmark app.

Return strict JSON only with this shape:
{
  "diagnosisSummary": "brief diagnosis",
  "suspectedFiles": ["src/file.js"],
  "notes": "optional short notes",
  "patch": "--- a/path\\n+++ b/path\\n@@ ..."
}

Rules:
- The patch must be a valid unified diff against the workspace root.
- Prefer the smallest correct fix.
- Do not mention the benchmark harness.
- If you are unsure, still provide the most plausible small patch.

App: ${context.appId}
Validation command: ${context.validationCommand}

Findings:
${findings}

Relevant traces:
${traces || "(none)"}

Candidate files:
${files || "(none)"}`;
}

function buildEstimatedRepairUsage(latencyMs: number, usage: {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}): RepairUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens + reasoningTokens;
  const costUsd = Number((totalTokens * 0.000001).toFixed(6));

  return {
    latencyMs,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens,
    costUsd,
    resolvedCostUsd: costUsd,
    costSource: "estimated",
    callCount: totalTokens > 0 ? 1 : 0,
    unavailableCalls: 0
  };
}

async function runOpenRouterRepairModel(input: {
  model: ModelAvailability;
  systemPrompt: string;
  prompt: string;
}): Promise<{ text: string; usage: RepairUsage }> {
  if (!isOpenRouterCostTrackingEnabled()) {
    throw new Error("OPENROUTER_API_KEY is required for repair model execution");
  }

  const startedAt = Date.now();
  const result = await generateText({
    model: createOpenRouterLanguageModel(input.model.id),
    temperature: 0.1,
    system: input.systemPrompt,
    prompt: input.prompt
  });

  const record = await buildOpenRouterUsageRecord({
    result,
    requestedModelId: input.model.id,
    requestedProvider: input.model.provider,
    phase: "repair",
    operation: "agent",
    startedAt
  });
  const usage = summarizeAiUsage([record]);

  return {
    text: result.text,
    usage: {
      latencyMs: usage.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
      resolvedCostUsd: usage.resolvedCostUsd,
      costSource: usage.costSource,
      callCount: usage.callCount,
      unavailableCalls: usage.unavailableCalls
    }
  };
}

export class OpenRouterRepairModelClient implements RepairModelClient {
  async repair(input: {
    model: ModelAvailability;
    systemPrompt: string;
    context: RepairPromptContext;
  }): Promise<RepairModelResult> {
    const prompt = formatRepairPrompt(input.context);
    const providerResponse = await runOpenRouterRepairModel({
      model: input.model,
      systemPrompt: input.systemPrompt,
      prompt
    });
    return parseRepairResult(providerResponse.text, providerResponse.usage);
  }
}

export class MockRepairModelClient implements RepairModelClient {
  async repair(input: {
    model: ModelAvailability;
    systemPrompt: string;
    context: RepairPromptContext;
  }): Promise<RepairModelResult> {
    const startedAt = Date.now();
    const files = input.context.candidateFiles;
    const failingTaskIds = new Set(input.context.findings.map((finding) => finding.taskId));
    let patch: string | undefined;
    let suspectedFiles: string[] = [];
    let summary = "No likely fix found.";

    const storeFile = files.find((file) => file.path === "src/todo-store.js");
    if (storeFile) {
      suspectedFiles = ["src/todo-store.js"];

      if (failingTaskIds.has("guided-add-task") && storeFile.content.includes('text: "New task"')) {
        summary = "Todo creation ignores the submitted label in the shared store helper.";
        patch = [
          "--- a/src/todo-store.js",
          "+++ b/src/todo-store.js",
          "@@ -6,7 +6,7 @@ export const initialTodos = [",
          " export function createTodo(text) {",
          "   return {",
          "     id: `todo-${Math.random().toString(36).slice(2, 10)}`,",
          '-    text: "New task",',
          "+    text: text.trim(),",
          "     done: false",
          "   };",
          " }"
        ].join("\n");
      } else if (
        (failingTaskIds.has("guided-complete-task") || failingTaskIds.has("guided-filter-active")) &&
        storeFile.content.includes("export function toggleTodo") &&
        storeFile.content.includes("return todos;")
      ) {
        summary = "Todo completion never updates the `done` flag in the shared store helper.";
        patch = [
          "--- a/src/todo-store.js",
          "+++ b/src/todo-store.js",
          "@@ -19,7 +19,7 @@ export function addTodo(todos, text) {",
          " }",
          " ",
          " export function toggleTodo(todos, id) {",
          "-  return todos;",
          "+  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));",
          " }",
          " ",
          " export function updateTodoText(todos, id, text) {"
        ].join("\n");
      } else if (
        failingTaskIds.has("guided-edit-task") &&
        storeFile.content.includes("updateTodoText") &&
        storeFile.content.includes("return todos;")
      ) {
        summary = "Todo editing discards the updated text in the shared store helper.";
        patch = [
          "--- a/src/todo-store.js",
          "+++ b/src/todo-store.js",
          "@@ -29,7 +29,7 @@ export function updateTodoText(todos, id, text) {",
          "     return todos;",
          "   }",
          " ",
          "-  return todos;",
          "+  return todos.map((todo) => (todo.id === id ? { ...todo, text: trimmed } : todo));",
          " }",
          " ",
          " export function removeTodo(todos, id) {"
        ].join("\n");
      }
    }

    const rawResponse = JSON.stringify(
      {
        diagnosisSummary: summary,
        suspectedFiles,
        patch
      },
      null,
      2
    );
    return parseRepairResult(rawResponse, buildEstimatedRepairUsage(Date.now() - startedAt, {
      inputTokens: 120,
      outputTokens: 240,
      totalTokens: 360
    }));
  }
}
