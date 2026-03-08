import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function copyDir(source: string, destination: string): Promise<void> {
  await ensureDir(dirname(destination));
  await cp(source, destination, { recursive: true, force: true });
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeText(path: string, value: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, value, "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function resolveWorkspacePath(pathLike: string): Promise<string> {
  if (isAbsolute(pathLike)) {
    return pathLike;
  }

  let cursor = process.cwd();
  while (true) {
    const candidate = join(cursor, pathLike);
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }

  return resolve(process.cwd(), pathLike);
}
