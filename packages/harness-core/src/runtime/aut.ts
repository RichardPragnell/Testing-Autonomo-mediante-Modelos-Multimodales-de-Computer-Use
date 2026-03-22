import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { AutConfig } from "../types.js";

export interface RunningAut {
  stop: () => Promise<void>;
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function startAut(
  aut: AutConfig,
  timeoutMs = 60_000,
  pollIntervalMs = 200
): Promise<RunningAut | undefined> {
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
    await delay(pollIntervalMs);
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
        await waitForClose(child);
        await delay(100);
        return;
      }
      child.kill("SIGTERM");
      await Promise.race([waitForClose(child), delay(500)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForClose(child);
      }
    }
  };
}
