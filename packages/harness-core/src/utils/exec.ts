import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function execCommand(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
  }
): Promise<ExecResult> {
  const child = spawn(command, {
    shell: true,
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    stdio: "pipe"
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  if (options?.stdin) {
    child.stdin.write(options.stdin);
  }
  child.stdin.end();

  return new Promise((resolve) => {
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
    child.once("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim()
      });
    });
  });
}

