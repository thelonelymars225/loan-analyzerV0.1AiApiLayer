import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvalidStorageKeyError,
  ObjectNotFoundError,
  S3Storage,
  s3ConfigFromEnv,
} from "../src";

const KEY = "orgs/org_test/documents/doc_test.pdf";

/** A client that never touches the network: `send` is replaced per test. */
function fakeClient(reply: (command: unknown) => unknown) {
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const send = vi
    .spyOn(client, "send")
    .mockImplementation(async (command: unknown) => reply(command) as never);
  return { client, send };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3Storage", () => {
  it("puts objects with server-side encryption and the content type", async () => {
    const { client, send } = fakeClient(() => ({}));
    const storage = new S3Storage(client, "contracts");
    await storage.put(KEY, Buffer.from("%PDF"), "application/pdf");

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "contracts",
      Key: KEY,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    });
  });

  it("returns the object body as a Buffer", async () => {
    const { client, send } = fakeClient(() => ({
      Body: { transformToByteArray: async () => new Uint8Array([37, 80, 68, 70]) },
    }));
    const body = await new S3Storage(client, "contracts").get(KEY);
    expect(body.toString()).toBe("%PDF");
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("maps NoSuchKey to ObjectNotFoundError", async () => {
    const { client } = fakeClient(() => {
      throw new NoSuchKey({ message: "missing", $metadata: {} });
    });
    await expect(new S3Storage(client, "contracts").get(KEY)).rejects.toThrow(
      ObjectNotFoundError,
    );
  });

  it("passes other errors through", async () => {
    const { client } = fakeClient(() => {
      throw new Error("AccessDenied");
    });
    await expect(new S3Storage(client, "contracts").get(KEY)).rejects.toThrow(
      "AccessDenied",
    );
  });

  it("deletes objects", async () => {
    const { client, send } = fakeClient(() => ({}));
    await new S3Storage(client, "contracts").delete(KEY);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: "contracts",
      Key: KEY,
    });
  });

  it("rejects unsafe keys without calling S3", async () => {
    const { client, send } = fakeClient(() => ({}));
    const storage = new S3Storage(client, "contracts");
    await expect(storage.put("../x", Buffer.alloc(1), "application/pdf")).rejects.toThrow(
      InvalidStorageKeyError,
    );
    await expect(storage.get("/x")).rejects.toThrow(InvalidStorageKeyError);
    await expect(storage.delete("a//b")).rejects.toThrow(InvalidStorageKeyError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("s3ConfigFromEnv", () => {
  it("reads a MinIO-style configuration", () => {
    const { bucket, clientConfig } = s3ConfigFromEnv({
      S3_BUCKET: "contracts",
      S3_REGION: "me-central-1",
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true",
      S3_ACCESS_KEY_ID: "minio",
      S3_SECRET_ACCESS_KEY: "minio-secret",
    });
    expect(bucket).toBe("contracts");
    expect(clientConfig).toEqual({
      region: "me-central-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "minio", secretAccessKey: "minio-secret" },
    });
  });

  it("uses defaults and the SDK credential chain when only the bucket is set", () => {
    const { clientConfig } = s3ConfigFromEnv({ S3_BUCKET: "contracts" });
    expect(clientConfig).toEqual({ region: "us-east-1", forcePathStyle: false });
  });

  it("requires a bucket", () => {
    expect(() => s3ConfigFromEnv({})).toThrow(/S3_BUCKET/);
  });

  it("refuses half-set credentials", () => {
    expect(() =>
      s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "only-id" }),
    ).toThrow(/both/);
  });
});
