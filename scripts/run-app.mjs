import { mkdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const nodeModulesRoot = join(repoRoot, "node_modules");

const apps = {
  "todo-react": {
    cwd: repoRoot,
    command: process.execPath,
    args: [
      join(nodeModulesRoot, "vite", "bin", "vite.js"),
      "--config",
      "apps/todo-react/template/vite.config.js",
      "--host",
      "127.0.0.1",
      "--port",
      "3101"
    ]
  },
  "todo-nextjs": {
    cwd: join(repoRoot, "apps", "todo-nextjs", "template"),
    command: process.execPath,
    args: [
      join(nodeModulesRoot, "next", "dist", "bin", "next"),
      "dev",
      ".",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3102",
      "--webpack"
    ]
  },
  "todo-angular": {
    cwd: join(repoRoot, "apps", "todo-angular", "template"),
    command: process.execPath,
    args: [
      join(nodeModulesRoot, "@angular", "cli", "bin", "ng.js"),
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "3103"
    ],
    setup: ensureTemplateNodeModules
  }
};

async function ensureTemplateNodeModules(templateDir) {
  const linkPath = join(templateDir, "node_modules");
  try {
    await mkdir(templateDir, { recursive: true });
    await symlink(nodeModulesRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

async function main() {
  const appId = process.argv[2];
  const app = apps[appId];

  if (!app) {
    const available = Object.keys(apps).join(", ");
    throw new Error(`unknown app "${appId}". Expected one of: ${available}`);
  }

  if (app.setup) {
    await app.setup(app.cwd);
  }

  const child = spawn(app.command, app.args, {
    cwd: app.cwd,
    env: {
      ...process.env,
      NG_CLI_ANALYTICS: process.env.NG_CLI_ANALYTICS ?? "false",
      PORT:
        appId === "todo-react" ? "3101" : appId === "todo-nextjs" ? "3102" : appId === "todo-angular" ? "3103" : ""
    },
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

await main();
