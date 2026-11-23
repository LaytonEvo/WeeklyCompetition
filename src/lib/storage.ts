import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { hmac, randomToken, safeEqual } from "@/lib/crypto";

/**
 * Private evidence storage. Files are never publicly addressable: staff view
 * them via short-lived HMAC-signed URLs served by /api/evidence/[...key].
 *
 * Drivers:
 *  - local: development only (serverless filesystems are ephemeral).
 *  - s3: any S3-compatible private bucket. Implemented against the AWS SDK
 *        but NOT yet verified against a real bucket — see DEPLOYMENT.md.
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const localDriver = (): StorageDriver => {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const resolve = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, data) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data, { mode: 0o600 });
    },
    get: (key) => readFile(resolve(key)),
    async remove(key) {
      await unlink(resolve(key)).catch(() => undefined);
    },
  };
};

const s3Driver = (): StorageDriver => {
  const e = env();
  const load = async () => {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(e.S3_ENDPOINT),
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });
    return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
  };
  return {
    async put(key, data, contentType) {
      const { client, PutObjectCommand } = await load();
      await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: "AES256" }));
    },
    async get(key) {
      const { client, GetObjectCommand } = await load();
      const res = await client.send(new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async remove(key) {
      const { client, DeleteObjectCommand } = await load();
      await client.send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
    },
  };
};

export function storage(): StorageDriver {
  return env().STORAGE_DRIVER === "s3" ? s3Driver() : localDriver();
}

export const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

/** Validate by magic bytes, not just the client-declared type. */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function newEvidenceKey(roundId: string, ext: string) {
  return `evidence/${roundId}/${Date.now()}-${randomToken(9)}.${ext}`;
}

export function signEvidenceUrl(key: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${key}:${exp}`);
  return `/api/evidence?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

export function verifyEvidenceSignature(key: string, exp: string, sig: string) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(hmac(`${key}:${e}`), sig);
}
