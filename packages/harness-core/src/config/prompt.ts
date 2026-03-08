import { readText, resolveWorkspacePath } from "../utils/fs.js";

export async function loadPromptText(promptId: string, promptsRoot = "experiments/prompts"): Promise<string> {
  const root = await resolveWorkspacePath(promptsRoot);
  return readText(`${root}/${promptId}.txt`);
}
