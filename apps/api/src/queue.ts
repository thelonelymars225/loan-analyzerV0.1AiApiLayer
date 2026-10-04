import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { QUEUES, RATE_QUEUE_OPTIONS } from "@rater/contracts";
import { errorForLog } from "./logger";

/** Hands ratings to the worker. Tests use an in-memory fake. */
export interface RatingQueue {
  /** Enqueues one job for the rating. */
  send(ratingId: string): Promise<void>;
  /** True when the queue can accept jobs (used by /healthz). */
  healthy(): Promise<boolean>;
}

/** The job payload on QUEUES.rate. The worker reads `ratingId` and loads the rest from Postgres. */
export interface RateJobData {
  ratingId: string;
}

/**
 * pg-boss on the same Postgres as the app. The API only sends jobs: maintenance and cron
 * ("supervise" and "schedule") are left to the worker.
 */
export class PgBossQueue implements RatingQueue {
  private constructor(private readonly boss: PgBoss) {}

  static async start(connectionString: string, logger: Logger): Promise<PgBossQueue> {
    const boss = new PgBoss({ connectionString, supervise: false, schedule: false });
    // Without a listener an "error" event would crash the process.
    boss.on("error", (error) =>
      logger.error({ err: errorForLog(error) }, "pg-boss error"),
    );
    await boss.start();
    // createQueue is "insert if missing", so the API passes the same options as the worker.
    await boss.createQueue(QUEUES.rate, { ...RATE_QUEUE_OPTIONS });
    return new PgBossQueue(boss);
  }

  async send(ratingId: string): Promise<void> {
    const data: RateJobData = { ratingId };
    await this.boss.send(QUEUES.rate, data);
  }

  async healthy(): Promise<boolean> {
    try {
      return (await this.boss.getQueue(QUEUES.rate)) !== null;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }
}
