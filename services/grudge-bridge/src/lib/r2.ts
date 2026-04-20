/**
 * Cloudflare R2 Client — backup storage operations
 *
 * Bucket: grudge-assets
 * Prefix: backups/mysql/{daily|weekly|manifests}/
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { BridgeConfig } from "../bridge.config";
import { Readable } from "stream";

let _client: S3Client | null = null;

export function getR2Client(config: BridgeConfig): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: config.r2.endpoint,
      region: config.r2.region,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

export interface BackupEntry {
  key: string;
  file: string;
  size: number;
  lastModified: Date;
  type: "daily" | "weekly" | "manifest";
}

/** List all backups in R2 under the configured prefix */
export async function listBackups(
  config: BridgeConfig,
  type?: "daily" | "weekly"
): Promise<BackupEntry[]> {
  const client = getR2Client(config);
  const prefix = type
    ? `${config.r2.backupPrefix}/${type}/`
    : `${config.r2.backupPrefix}/`;

  const entries: BackupEntry[] = [];
  let continuationToken: string | undefined;

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: config.r2.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of resp.Contents || []) {
      if (!obj.Key || !obj.Size) continue;

      const file = obj.Key.split("/").pop() || obj.Key;
      let entryType: BackupEntry["type"] = "daily";
      if (obj.Key.includes("/weekly/")) entryType = "weekly";
      else if (obj.Key.includes("/manifests/")) entryType = "manifest";

      entries.push({
        key: obj.Key,
        file,
        size: obj.Size,
        lastModified: obj.LastModified || new Date(),
        type: entryType,
      });
    }

    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  return entries.sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
  );
}

/** Download a backup from R2 as a readable stream */
export async function downloadBackup(
  config: BridgeConfig,
  key: string
): Promise<{ stream: Readable; size: number }> {
  const client = getR2Client(config);
  const resp = await client.send(
    new GetObjectCommand({ Bucket: config.r2.bucket, Key: key })
  );

  if (!resp.Body) throw new Error(`Empty body for ${key}`);

  const stream =
    resp.Body instanceof Readable
      ? resp.Body
      : Readable.from(resp.Body as AsyncIterable<Uint8Array>);

  return { stream, size: resp.ContentLength || 0 };
}

/** Upload a buffer or stream to R2 */
export async function uploadBackup(
  config: BridgeConfig,
  key: string,
  body: Buffer | Readable,
  metadata?: Record<string, string>
): Promise<void> {
  const client = getR2Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: body,
      ContentType: key.endsWith(".json")
        ? "application/json"
        : "application/gzip",
      Metadata: metadata,
    })
  );
}

/** Delete a backup from R2 */
export async function deleteBackup(
  config: BridgeConfig,
  key: string
): Promise<void> {
  const client = getR2Client(config);
  await client.send(
    new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key })
  );
}

/** Get JSON content of a manifest from R2 */
export async function getManifest(
  config: BridgeConfig,
  timestampOrKey: string
): Promise<Record<string, unknown> | null> {
  const key = timestampOrKey.includes("/")
    ? timestampOrKey
    : `${config.r2.backupPrefix}/manifests/${timestampOrKey}.json`;

  try {
    const { stream } = await downloadBackup(config, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return null;
  }
}
