import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(appRoot, "public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function resolvePort() {
  const cliPortIndex = process.argv.findIndex((value) => value === "--port");
  const cliPort =
    cliPortIndex >= 0 && cliPortIndex + 1 < process.argv.length
      ? Number.parseInt(process.argv[cliPortIndex + 1] ?? "", 10)
      : Number.NaN;
  const envPort = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(cliPort) ? cliPort : Number.isFinite(envPort) ? envPort : 3000;
}

function asAssetPath(pathname) {
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(candidate).replace(/\\/g, "/");
  const absolute = resolve(publicRoot, `.${normalized}`);
  return absolute.startsWith(publicRoot) ? absolute : undefined;
}

function serveFile(response, filePath, pathname) {
  const type = contentTypes[extname(pathname)] ?? "application/octet-stream";
  response.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const assetPath = asAssetPath(requestUrl.pathname);
  if (!assetPath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("forbidden");
    return;
  }

  try {
    const details = await stat(assetPath);
    if (!details.isFile()) {
      throw new Error("not a file");
    }
    serveFile(response, assetPath, requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    return;
  } catch {
    if (extname(requestUrl.pathname)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
  }

  serveFile(response, join(publicRoot, "index.html"), "/index.html");
}

export async function startPulseLabServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? resolvePort();
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("internal server error");
    });
  });

  await new Promise((resolvePromise) => {
    server.listen(port, host, () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve pulse-lab server address");
  }

  return {
    port: address.port,
    url: `http://${host}:${address.port}`,
    stop: async () => {
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    }
  };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  startPulseLabServer()
    .then((handle) => {
      process.stdout.write(`pulse-lab ready at ${handle.url}\n`);
    })
    .catch((error) => {
      process.stderr.write(`pulse-lab failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
