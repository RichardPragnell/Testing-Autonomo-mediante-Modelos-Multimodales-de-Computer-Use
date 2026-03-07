import { createHash } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableTextHash(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return sha256(normalized);
}
