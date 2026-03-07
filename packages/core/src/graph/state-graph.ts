import { sha256, stableTextHash } from "../utils/hash.js";
import type { CoverageGraphEdge, CoverageGraphNode, CoverageGraphSnapshot } from "../types.js";

export interface StateFingerprintInput {
  url: string;
  domSnapshot?: string;
  screenshotBase64?: string;
}

function reduceDom(domSnapshot?: string): string {
  if (!domSnapshot) {
    return "";
  }
  return domSnapshot
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .replace(/\d+/g, "#")
    .trim();
}

export function fingerprintState(input: StateFingerprintInput): {
  id: string;
  domHash: string;
  visualHash: string;
} {
  const reducedDom = reduceDom(input.domSnapshot);
  const domHash = stableTextHash(reducedDom);
  const visualHash = input.screenshotBase64 ? sha256(input.screenshotBase64) : sha256("no-screenshot");
  const id = sha256(`${input.url}|${domHash}|${visualHash}`);
  return { id, domHash, visualHash };
}

export class CoverageGraph {
  private nodes = new Map<string, CoverageGraphNode>();
  private edges = new Map<string, CoverageGraphEdge>();

  upsertState(input: StateFingerprintInput): string {
    const fingerprint = fingerprintState(input);
    const current = this.nodes.get(fingerprint.id);
    if (current) {
      current.visits += 1;
      return current.id;
    }
    this.nodes.set(fingerprint.id, {
      id: fingerprint.id,
      url: input.url,
      domHash: fingerprint.domHash,
      visualHash: fingerprint.visualHash,
      visits: 1
    });
    return fingerprint.id;
  }

  addTransition(from: string, to: string, action: string): void {
    const edgeKey = `${from}->${to}:${action}`;
    const current = this.edges.get(edgeKey);
    if (current) {
      current.count += 1;
      return;
    }
    this.edges.set(edgeKey, {
      from,
      to,
      action,
      count: 1
    });
  }

  noveltyScore(nodeId: string): number {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return 1;
    }
    return 1 / (1 + node.visits);
  }

  pickNovelFrontier(candidateNodeIds: string[]): string | undefined {
    return [...candidateNodeIds]
      .sort((a, b) => this.noveltyScore(b) - this.noveltyScore(a))
      .at(0);
  }

  snapshot(): CoverageGraphSnapshot {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()]
    };
  }
}
