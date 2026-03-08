import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { AutConfig } from "../types.js";

export interface RunningAut {
  stop: () => Promise<void>;
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function startAut(aut: AutConfig, timeoutMs = 60_000): Promise<RunningAut | undefined> {
  if (!aut.command) {
    return undefined;
  }
  const child = spawn(aut.command, {
    cwd: aut.cwd ?? process.cwd(),
    env: { ...process.env, ...aut.env },
    shell: true,
    stdio: "inherit"
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`AUT process exited before becoming reachable with code ${child.exitCode}`);
    }
    if (await isUrlReachable(aut.url)) {
      break;
    }
    await delay(1_000);
  }

  if (!(await isUrlReachable(aut.url))) {
    throw new Error(`AUT did not become reachable at ${aut.url} within ${timeoutMs}ms`);
  }

  return {
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
          stdio: "ignore"
        });
        await new Promise<void>((resolve) => {
          killer.once("close", () => resolve());
          killer.once("error", () => resolve());
        });
        return;
      }
      child.kill("SIGTERM");
      await delay(500);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
  };
}

