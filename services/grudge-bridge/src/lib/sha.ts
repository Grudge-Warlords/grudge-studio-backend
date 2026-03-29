/**
 * SHA-256 Integrity System
 *
 * Every backup gets a companion manifest with SHA-256 hash.
 * Restores always verify before applying.
 */

import crypto from "crypto";
import { Readable, PassThrough } from "stream";

export interface BackupManifest {
  file: string;
  sha256: string;
  size: number;
  tables: number;
  created: string;
  node: string;
  duration?: number;
}

/** Compute SHA-256 of a buffer */
export function sha256Buffer(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Create a pass-through stream that computes SHA-256 as data flows through.
 * Call getHash() after the stream ends to get the hex digest.
 */
export function createHashingStream(): PassThrough & { getHash: () => string } {
  const hash = crypto.createHash("sha256");
  const passthrough = new PassThrough();

  passthrough.on("data", (chunk: Buffer) => {
    hash.update(chunk);
  });

  (passthrough as any).getHash = () => hash.digest("hex");
  return passthrough as PassThrough & { getHash: () => string };
}

/** Compute SHA-256 of a readable stream (consumes the stream) */
export async function sha256Stream(stream: Readable): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** Build a manifest JSON object */
export function buildManifest(
  file: string,
  sha256: string,
  size: number,
  tables: number,
  nodeName: string,
  duration?: number
): BackupManifest {
  return {
    file,
    sha256,
    size,
    tables,
    created: new Date().toISOString(),
    node: nodeName,
    duration,
  };
}

/** Verify a buffer against an expected SHA-256 hash */
export function verifySha256(data: Buffer, expectedHash: string): boolean {
  const actual = sha256Buffer(data);
  return actual === expectedHash;
}
