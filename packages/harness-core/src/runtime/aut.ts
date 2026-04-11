import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { AutConfig } from "../types.js";

export interface RunningAut {
  stop: () => Promise<void>;
}

type SpawnedChild = ReturnType<typeof spawn>;
const activeAutChildren = new Set<SpawnedChild>();
let exitCleanupInstalled = false;
const MAX_AUT_OUTPUT_CHARS = 4_000;

function appendOutputTail(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length <= MAX_AUT_OUTPUT_CHARS ? next : next.slice(-MAX_AUT_OUTPUT_CHARS);
}

function summarizeAutOutput(stdoutTail: string, stderrTail: string): string {
  const sections: string[] = [];

  const normalizedStdout = stdoutTail.trim();
  if (normalizedStdout) {
    sections.push(`stdout:\n${normalizedStdout}`);
  }

  const normalizedStderr = stderrTail.trim();
  if (normalizedStderr) {
    sections.push(`stderr:\n${normalizedStderr}`);
  }

  return sections.join("\n\n");
}

function formatAutFailureMessage(input: {
  reason: string;
  command: string;
  cwd: string;
  stdoutTail: string;
  stderrTail: string;
}): string {
  const output = summarizeAutOutput(input.stdoutTail, input.stderrTail);
  return output
    ? `${input.reason}\nCommand: ${input.command}\nCwd: ${input.cwd}\n${output}`
    : `${input.reason}\nCommand: ${input.command}\nCwd: ${input.cwd}`;
}

function registerAutChild(child: SpawnedChild): void {
  if (!exitCleanupInstalled) {
    process.once("exit", () => {
      for (const activeChild of [...activeAutChildren]) {
        stopSpawnedAutSync(activeChild);
      }
      activeAutChildren.clear();
    });
    exitCleanupInstalled = true;
  }

  activeAutChildren.add(child);
  const unregister = (): void => {
    activeAutChildren.delete(child);
  };
  child.once("close", unregister);
  child.once("error", unregister);
}

function waitForClose(child: SpawnedChild): Promise<void> {
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

async function waitForUrlToStop(url: string, timeoutMs = 5_000, pollIntervalMs = 100): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isUrlReachable(url))) {
      return;
    }
    await delay(pollIntervalMs);
  }
}

function signalChildProcessGroup(child: SpawnedChild, signal: "SIGTERM" | "SIGKILL"): boolean {
  if (!child.pid) {
    return false;
  }

  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

function stopSpawnedAutSync(child: SpawnedChild): void {
  activeAutChildren.delete(child);
  if (child.exitCode !== null || !child.pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true
      });
    } catch {
      // Best-effort cleanup during process shutdown.
    }
    return;
  }

  if (!signalChildProcessGroup(child, "SIGKILL")) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Best-effort cleanup during process shutdown.
    }
  }
}

async function stopSpawnedAut(child: SpawnedChild): Promise<void> {
  if (child.exitCode !== null || child.killed) {
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

  if (!signalChildProcessGroup(child, "SIGTERM")) {
    child.kill("SIGTERM");
  }
  await Promise.race([waitForClose(child), delay(500)]);
  if (child.exitCode === null) {
    if (!signalChildProcessGroup(child, "SIGKILL")) {
      child.kill("SIGKILL");
    }
    await waitForClose(child);
  }
}

export async function startAut(
  aut: AutConfig,
  timeoutMs = 60_000,
  pollIntervalMs = 200
): Promise<RunningAut | undefined> {
  let releasedPort = false;
  const releasePort = (): void => {
    if (releasedPort) {
      return;
    }
    releasedPort = true;
    aut.releasePort?.();
  };

  if (!aut.command) {
    releasePort();
    return undefined;
  }
  const cwd = aut.cwd ?? process.cwd();
  let stdoutTail = "";
  let stderrTail = "";
  const child = spawn(aut.command, {
    cwd,
    env: { ...process.env, ...aut.env },
    detached: process.platform !== "win32",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutTail = appendOutputTail(stdoutTail, chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = appendOutputTail(stderrTail, chunk);
    process.stderr.write(chunk);
  });
  registerAutChild(child);

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(
          formatAutFailureMessage({
            reason: `AUT process exited before becoming reachable with code ${child.exitCode}`,
            command: aut.command,
            cwd,
            stdoutTail,
            stderrTail
          })
        );
      }
      if (await isUrlReachable(aut.url)) {
        break;
      }
      await delay(pollIntervalMs);
    }

    if (!(await isUrlReachable(aut.url))) {
      throw new Error(
        formatAutFailureMessage({
          reason: `AUT did not become reachable at ${aut.url} within ${timeoutMs}ms`,
          command: aut.command,
          cwd,
          stdoutTail,
          stderrTail
        })
      );
    }

    return {
      stop: async () => {
        try {
          await stopSpawnedAut(child);
          await waitForUrlToStop(aut.url);
        } finally {
          releasePort();
        }
      }
    };
  } catch (error) {
    try {
      await stopSpawnedAut(child);
      await waitForUrlToStop(aut.url);
    } finally {
      releasePort();
    }
    throw error;
  }
}
