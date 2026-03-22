import type { ModelAvailability } from "../types.js";
import type { RepairModelResult, RepairPromptContext } from "../experiments/types.js";

export interface RepairModelClient {
  repair(input: {
    model: ModelAvailability;
    systemPrompt: string;
    context: RepairPromptContext;
  }): Promise<RepairModelResult>;
}

interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function estimateCostUsd(totalTokens: number): number {
  return Number((totalTokens * 0.000001).toFixed(6));
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

function parseRepairResult(raw: string, latencyMs: number, usage?: Partial<ProviderResponse>): RepairModelResult {
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

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;

  return {
    diagnosis: {
      summary: diagnosisSummary,
      suspectedFiles,
      notes
    },
    patch,
    usage: {
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd: estimateCostUsd(totalTokens)
    },
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

async function readJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`provider returned non-JSON response: ${raw.slice(0, 400)}`);
  }
}

async function runOpenAiLike(modelName: string, apiKey: string, systemPrompt: string, prompt: string): Promise<ProviderResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]
    })
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(json.error?.message ?? `OpenAI request failed with status ${response.status}`);
  }

  return {
    text: String(json.choices?.[0]?.message?.content ?? ""),
    inputTokens: Number(json.usage?.prompt_tokens ?? 0),
    outputTokens: Number(json.usage?.completion_tokens ?? 0),
    totalTokens: Number(json.usage?.total_tokens ?? 0)
  };
}

async function runAnthropic(modelName: string, apiKey: string, systemPrompt: string, prompt: string): Promise<ProviderResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(json.error?.message ?? `Anthropic request failed with status ${response.status}`);
  }

  const text = Array.isArray(json.content)
    ? json.content.map((item: { text?: string }) => item.text ?? "").join("\n")
    : "";

  return {
    text,
    inputTokens: Number(json.usage?.input_tokens ?? 0),
    outputTokens: Number(json.usage?.output_tokens ?? 0),
    totalTokens: Number((json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0))
  };
}

async function runGoogle(modelName: string, apiKey: string, systemPrompt: string, prompt: string): Promise<ProviderResponse> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    })
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(json.error?.message ?? `Google request failed with status ${response.status}`);
  }

  const text = Array.isArray(json.candidates)
    ? json.candidates
        .flatMap((candidate: { content?: { parts?: Array<{ text?: string }> } }) => candidate.content?.parts ?? [])
        .map((part: { text?: string }) => part.text ?? "")
        .join("\n")
    : "";

  return {
    text,
    inputTokens: Number(json.usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(json.usageMetadata?.candidatesTokenCount ?? 0),
    totalTokens: Number(json.usageMetadata?.totalTokenCount ?? 0)
  };
}

export class ProviderRepairModelClient implements RepairModelClient {
  async repair(input: {
    model: ModelAvailability;
    systemPrompt: string;
    context: RepairPromptContext;
  }): Promise<RepairModelResult> {
    const startedAt = Date.now();
    const prompt = formatRepairPrompt(input.context);
    const apiKey = process.env[input.model.envKey];
    if (!apiKey) {
      throw new Error(`missing required env key ${input.model.envKey}`);
    }

    const [, modelName = input.model.id] = input.model.id.split("/", 2);
    let providerResponse: ProviderResponse;

    if (input.model.provider === "openai") {
      providerResponse = await runOpenAiLike(modelName, apiKey, input.systemPrompt, prompt);
    } else if (input.model.provider === "anthropic") {
      providerResponse = await runAnthropic(modelName, apiKey, input.systemPrompt, prompt);
    } else if (input.model.provider === "google") {
      providerResponse = await runGoogle(modelName, apiKey, input.systemPrompt, prompt);
    } else {
      throw new Error(`unsupported repair model provider ${input.model.provider}`);
    }

    return parseRepairResult(providerResponse.text, Date.now() - startedAt, providerResponse);
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
    return parseRepairResult(rawResponse, Date.now() - startedAt, {
      inputTokens: 120,
      outputTokens: 240,
      totalTokens: 360
    });
  }
}
