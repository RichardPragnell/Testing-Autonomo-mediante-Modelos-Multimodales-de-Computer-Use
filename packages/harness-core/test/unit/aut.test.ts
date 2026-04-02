import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { startAut } from "../../src/runtime/aut.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000, pollIntervalMs = 50): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function allocatePort(): Promise<number> {
  const host = "127.0.0.1";
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("expected TCP address");
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(address.port);
    });
  });
}

async function readPid(pidPath: string): Promise<number> {
  let pidValue = "";
  await waitFor(async () => {
    try {
      pidValue = (await readFile(pidPath, "utf8")).trim();
      return pidValue.length > 0;
    } catch {
      return false;
    }
  });

  const pid = Number.parseInt(pidValue, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`invalid pid value "${pidValue}"`);
  }
  return pid;
}

describe("startAut", () => {
  it("kills the spawned AUT process if startup times out before readiness", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aut-timeout-"));
    tempDirs.push(dir);
    const pidPath = join(dir, "idle.pid");
    const scriptPath = join(dir, "idle.cjs");
    const port = await allocatePort();
    const url = `http://127.0.0.1:${port}`;

    await writeFile(
      scriptPath,
      [
        'const { writeFileSync } = require("node:fs");',
        'writeFileSync(process.argv[2], String(process.pid), "utf8");',
        "setInterval(() => {}, 1_000);"
      ].join("\n"),
      "utf8"
    );

    await expect(
      startAut(
        {
          command: `node "${scriptPath}" "${pidPath}"`,
          cwd: dir,
          url
        },
        250,
        25
      )
    ).rejects.toThrow(`AUT did not become reachable at ${url}`);

    const pid = await readPid(pidPath);
    await waitFor(() => !processExists(pid));
  });

  it("stops the AUT process tree after a successful start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aut-stop-"));
    tempDirs.push(dir);
    const pidPath = join(dir, "server.pid");
    const scriptPath = join(dir, "server.cjs");
    const port = await allocatePort();
    const url = `http://127.0.0.1:${port}`;

    await writeFile(
      scriptPath,
      [
        'const { createServer } = require("node:http");',
        'const { writeFileSync } = require("node:fs");',
        "const port = Number.parseInt(process.argv[2], 10);",
        'const pidPath = process.argv[3];',
        'const server = createServer((_req, res) => res.end("ok"));',
        'server.listen(port, "127.0.0.1", () => {',
        '  writeFileSync(pidPath, String(process.pid), "utf8");',
        "});",
        'const shutdown = () => server.close(() => process.exit(0));',
        'process.on("SIGTERM", shutdown);',
        'process.on("SIGINT", shutdown);',
        "setInterval(() => {}, 1_000);"
      ].join("\n"),
      "utf8"
    );

    const aut = await startAut(
      {
        command: `node "${scriptPath}" ${port} "${pidPath}"`,
        cwd: dir,
        url
      },
      5_000,
      25
    );

    const pid = await readPid(pidPath);
    expect(processExists(pid)).toBe(true);
    expect(await isUrlReachable(url)).toBe(true);

    await aut?.stop();

    await waitFor(() => !processExists(pid));
    expect(await isUrlReachable(url)).toBe(false);
  });
});
