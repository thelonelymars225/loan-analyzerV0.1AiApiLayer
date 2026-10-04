import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { pino } from "pino";
import { createDb, migrate } from "@rater/db";
import type { Db } from "@rater/db";
import { LocalStorage } from "@rater/storage";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { RatingQueue } from "../src/queue";

/**
 * Test harness: a throwaway database per test file (created on the server in DATABASE_URL,
 * migrated, dropped at the end), encrypted local storage in a temp folder, and a fake queue
 * that records what was sent. All people and companies here are made up.
 */
export const DATABASE_URL = process.env.DATABASE_URL;

export const ORIGIN = "http://localhost:5173";
const FIXTURES = fileURLToPath(
  new URL("../../../packages/core/test/fixtures/", import.meta.url),
);

export function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES, name));
}

export class FakeQueue implements RatingQueue {
  sent: string[] = [];
  failNext = false;
  isHealthy = true;

  async send(ratingId: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue unavailable");
    }
    this.sent.push(ratingId);
  }

  async healthy(): Promise<boolean> {
    return this.isHealthy;
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  pool: pg.Pool;
  storage: LocalStorage;
  storageDir: string;
  queue: FakeQueue;
  /** Moves the app's clock (used for rate-limit windows). */
  clock: { now: Date };
  close(): Promise<void>;
}

export interface TestOptions {
  env?: Record<string, string>;
  eventsPollMs?: number;
}

export async function createTestContext(options: TestOptions = {}): Promise<TestContext> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  const databaseName = `rater_api_test_${randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${databaseName}"`);
  const url = new URL(DATABASE_URL as string);
  url.pathname = `/${databaseName}`;
  await migrate(url.toString());

  const { db, pool } = createDb(url.toString(), { max: 5 });
  const storageDir = await mkdtemp(path.join(tmpdir(), "rater-api-storage-"));
  const storage = new LocalStorage({ dir: storageDir, encryptionKey: randomBytes(32) });
  const queue = new FakeQueue();
  const clock = { now: new Date() };

  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url.toString(),
    BETTER_AUTH_SECRET: "test-secret-for-the-api-tests-only-0123456789",
    LOG_LEVEL: "silent",
    DB_MIGRATE_ON_START: "false",
    ...options.env,
  });
  const app = await buildApp({
    config,
    db,
    storage,
    queue,
    logger: pino({ level: "silent" }),
    now: () => clock.now,
    eventsPollMs: options.eventsPollMs ?? 20,
  });
  await app.ready();

  return {
    app,
    db,
    pool,
    storage,
    storageDir,
    queue,
    clock,
    async close() {
      await app.close();
      await pool.end();
      await rm(storageDir, { recursive: true, force: true });
      await admin.query(`drop database if exists "${databaseName}" with (force)`);
      await admin.end();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

let userCount = 0;

/** A made-up address no other test uses. */
export function uniqueEmail(): string {
  userCount += 1;
  return `user${userCount}.${randomBytes(3).toString("hex")}@example.com`;
}

/** Signs up through Better Auth and returns the session cookie. */
export async function signUp(
  app: FastifyInstance,
  name = "Nour Al-Harbi",
  email = uniqueEmail(),
): Promise<TestUser> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { name, email, password: "correct-horse-battery-staple" },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-up failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json<{ user: { id: string } }>();
  return { id: body.user.id, email, cookie: sessionCookie(response) };
}

/** Signs in an existing user (a new session) and returns the session cookie. */
export async function signIn(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password: "correct-horse-battery-staple" },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  }
  return sessionCookie(response);
}

/** "name=value" pairs of every Set-Cookie header, ready for a Cookie header. */
export function sessionCookie(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Makes `orgId` the session's active org (PUT /me/active-org), like the web app. */
export async function setActiveOrg(
  app: FastifyInstance,
  cookie: string,
  orgId: string,
): Promise<void> {
  const response = await api(app, cookie, "PUT", "/me/active-org", { orgId });
  if (response.statusCode !== 200) {
    throw new Error(`set-active failed: ${response.statusCode} ${response.body}`);
  }
}

/** Builds a multipart/form-data body the way a browser's FormData does. */
export async function multipart(
  fields: Record<string, string>,
  file?: { content: Buffer; name?: string; type?: string; field?: string },
): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  if (file) {
    const blob = new Blob([new Uint8Array(file.content)], {
      type: file.type ?? "application/pdf",
    });
    form.append(file.field ?? "file", blob, file.name ?? "contract.pdf");
  }
  const request = new Request("http://localhost/", { method: "POST", body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  };
}

/** POST /api/v1/ratings with a PDF (and optionally a view) as the given user. */
export async function upload(
  app: FastifyInstance,
  cookie: string,
  content: Buffer,
  fields: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const body = await multipart(fields, { content });
  return app.inject({
    method: "POST",
    url: "/api/v1/ratings",
    headers: { ...body.headers, cookie, origin: ORIGIN },
    payload: body.payload,
  });
}

/** GET (or another method) on /api/v1 as the given user. */
export function api(
  app: FastifyInstance,
  cookie: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie, origin: ORIGIN, ...headers },
    ...(payload ? { payload } : {}),
  });
}
