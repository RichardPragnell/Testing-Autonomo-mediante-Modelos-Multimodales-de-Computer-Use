import { createServer } from "node:net";

export interface PortLease {
  port: number;
  release: () => void;
}

const reservedPortsByHost = new Map<string, Set<number>>();

function isReserved(host: string, port: number): boolean {
  return reservedPortsByHost.get(host)?.has(port) ?? false;
}

function reservePort(host: string, port: number): () => void {
  const reserved = reservedPortsByHost.get(host) ?? new Set<number>();
  reserved.add(port);
  reservedPortsByHost.set(host, reserved);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const current = reservedPortsByHost.get(host);
    if (!current) {
      return;
    }
    current.delete(port);
    if (current.size === 0) {
      reservedPortsByHost.delete(host);
    }
  };
}

async function canBindPort(host: string, port: number): Promise<boolean> {
  if (isReserved(host, port)) {
    return false;
  }

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

async function bindEphemeralPort(host: string): Promise<PortLease> {
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
      if (isReserved(host, port)) {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          void bindEphemeralPort(host).then(resolve, reject);
        });
        return;
      }

      const release = reservePort(host, port);
      server.close((error) => {
        if (error) {
          release();
          reject(error);
          return;
        }
        resolve({ port, release });
      });
    });
  });
}

export async function leaseAvailablePort(host: string, preferredPort: number): Promise<PortLease> {
  if (preferredPort > 0 && !isReserved(host, preferredPort) && (await canBindPort(host, preferredPort))) {
    return {
      port: preferredPort,
      release: reservePort(host, preferredPort)
    };
  }

  return bindEphemeralPort(host);
}
