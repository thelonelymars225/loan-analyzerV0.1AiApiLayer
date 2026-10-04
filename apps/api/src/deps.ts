import type { Db } from "@rater/db";
import type { ObjectStorage } from "@rater/storage";
import type { Auth } from "./auth";
import type { Config } from "./config";
import type { RatingQueue } from "./queue";

/** Everything the routes need, passed in by buildApp so tests can swap parts. */
export interface AppDeps {
  config: Config;
  db: Db;
  storage: ObjectStorage;
  queue: RatingQueue;
  auth: Auth;
  /** The clock. Tests pass a fixed one. */
  now: () => Date;
  /** How often the SSE stream re-reads a rating's status. */
  eventsPollMs: number;
}
