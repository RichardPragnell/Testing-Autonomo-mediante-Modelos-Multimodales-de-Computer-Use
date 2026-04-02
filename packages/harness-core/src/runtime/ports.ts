import { createServer } from "node:net";

async function canBindPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    server.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        finish(false);
        return;
      }
      reject(error);
    });

    server.listen({ host, port }, () => {
      server.close(() => finish(true));
    });
  });
}

async function bindEphemeralPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error(`unable to determine ephemeral port for host ${host}`)));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function resolveAvailablePort(host: string, preferredPort: number): Promise<number> {
  if (preferredPort > 0 && (await canBindPort(host, preferredPort))) {
    return preferredPort;
  }

  return bindEphemeralPort(host);
}
