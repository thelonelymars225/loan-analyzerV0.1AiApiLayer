import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { assertValidKey } from "./keys";
import { ObjectNotFoundError } from "./types";
import type { ObjectStorage } from "./types";

const DEFAULT_REGION = "us-east-1";

/**
 * Stores objects in an S3-compatible bucket (AWS S3, MinIO, ...). Every object is
 * written with server-side encryption (SSE-S3, AES256). MinIO only accepts that when it
 * has a KMS key configured (for example MINIO_KMS_SECRET_KEY).
 */
export class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  /** Reads S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE and the S3_* credentials. */
  static fromEnv(env: NodeJS.ProcessEnv): S3Storage {
    const { bucket, clientConfig } = s3ConfigFromEnv(env);
    return new S3Storage(new S3Client(clientConfig), bucket);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new ObjectNotFoundError(key);
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNoSuchKey(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  /** S3 deletes are already idempotent: deleting a missing key succeeds. */
  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv): {
  bucket: string;
  clientConfig: S3ClientConfig;
} {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  }
  const clientConfig: S3ClientConfig = {
    region: env.S3_REGION || DEFAULT_REGION,
    forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE),
  };
  if (env.S3_ENDPOINT) {
    clientConfig.endpoint = env.S3_ENDPOINT;
  }

  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  } else if (accessKeyId || secretAccessKey) {
    throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither");
  }
  // With neither set, the SDK's default chain applies (instance role, AWS_* variables, ...).

  return { bucket, clientConfig };
}

function parseBoolean(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

function isNoSuchKey(error: unknown): boolean {
  return (error as { name?: unknown } | undefined)?.name === "NoSuchKey";
}
