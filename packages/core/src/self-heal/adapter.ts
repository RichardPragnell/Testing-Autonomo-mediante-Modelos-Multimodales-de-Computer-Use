import { execCommand } from "../utils/exec.js";

export interface AgentPatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  patch: string | undefined;
}

function fromCodeFence(content: string): string | undefined {
  const fenced = content.match(/```(?:diff)?\s*([\s\S]*?)```/i);
  if (!fenced) {
    return undefined;
  }
  return fenced[1].trim();
}

export function extractUnifiedDiff(rawOutput: string): string | undefined {
  const fenced = fromCodeFence(rawOutput);
  const candidate = fenced ?? rawOutput;
  const hasMarkers =
    /(^|\n)---\s+.+/.test(candidate) && /(^|\n)\+\+\+\s+.+/.test(candidate) && /(^|\n)@@/.test(candidate);
  return hasMarkers ? `${candidate.trim()}\n` : undefined;
}

export async function runAgentForPatch(input: {
  command: string;
  context: unknown;
  cwd?: string;
}): Promise<AgentPatchResult> {
  const result = await execCommand(input.command, {
    cwd: input.cwd,
    stdin: `${JSON.stringify(input.context, null, 2)}\n`
  });
  const patch = extractUnifiedDiff(result.stdout);
  return {
    ...result,
    patch
  };
}

