import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

async function findRepoRoot(startDir) {
  let cursor = resolve(startDir);

  while (true) {
    const candidate = join(cursor, "pnpm-workspace.yaml");
    try {
      await access(candidate);
      return cursor;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new Error("todo-react could not resolve the monorepo root");
      }
      cursor = parent;
    }
  }
}

export default defineConfig(async () => {
  const repoRoot = process.env.BENCH_REPO_ROOT
    ? resolve(process.env.BENCH_REPO_ROOT)
    : await findRepoRoot(rootDir);
  const reactPluginModule = await import(
    pathToFileURL(join(repoRoot, "node_modules", "@vitejs", "plugin-react", "dist", "index.js")).href
  );
  const react = reactPluginModule.default;

  return {
    root: rootDir,
    plugins: [react()],
    resolve: {
      alias: {
        react: join(repoRoot, "node_modules", "react"),
        "react-dom": join(repoRoot, "node_modules", "react-dom")
      }
    },
    server: {
      host: "127.0.0.1",
      port: 3101
    }
  };
});
