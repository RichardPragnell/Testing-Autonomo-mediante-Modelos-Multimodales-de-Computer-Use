import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

let loadedEnvPath: string | undefined;

async function findProjectEnv(startDir = process.cwd()): Promise<string | null> {
  let cursor = resolve(startDir);

  while (true) {
    const candidate = join(cursor, ".env");
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        return null;
      }
      cursor = parent;
    }
  }
}

export async function loadProjectEnv(startDir = process.cwd()): Promise<string | null> {
  if (loadedEnvPath) {
    return loadedEnvPath;
  }

  const envPath = await findProjectEnv(startDir);
  if (!envPath) {
    return null;
  }

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }

  loadedEnvPath = envPath;
  return loadedEnvPath;
}
