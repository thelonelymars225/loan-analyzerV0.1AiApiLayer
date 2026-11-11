/**
 * Runs at most `size` tasks at once; the others wait their turn in arrival order.
 * Used to bound how many poppler processes the API runs for upload checks.
 */
export class ConcurrencyLimit {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.running >= this.size) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}

/**
 * Counts open long-lived connections (event streams) per user and in total, and refuses a new
 * one once either limit is reached. Unlike ConcurrencyLimit nothing waits: the caller answers
 * 429 and the client falls back to polling.
 */
export class ConnectionSlots {
  private total = 0;
  private readonly perUser = new Map<string, number>();

  constructor(private readonly limits: { perUser: number; total: number }) {}

  /** Takes a slot for the user; false when the user or the server is at its limit. */
  tryTake(userId: string): boolean {
    const mine = this.perUser.get(userId) ?? 0;
    if (mine >= this.limits.perUser || this.total >= this.limits.total) return false;
    this.perUser.set(userId, mine + 1);
    this.total += 1;
    return true;
  }

  /** Gives back a slot taken with tryTake. */
  release(userId: string): void {
    const mine = this.perUser.get(userId);
    if (!mine) return;
    if (mine === 1) this.perUser.delete(userId);
    else this.perUser.set(userId, mine - 1);
    this.total -= 1;
  }

  /** Open connections in total (for tests and diagnostics). */
  get open(): number {
    return this.total;
  }
}

/**
 * At most `limit` requests per user in each fixed window (e.g. a minute). Counts live in this
 * process's memory, so with several API processes each allows its own `limit`, and a restart
 * starts afresh: a guard against bursts, not an exact quota.
 */
export class RequestWindow {
  private readonly counts = new Map<string, { start: number; count: number }>();

  constructor(private readonly options: { limit: number; windowMs: number }) {}

  /** Counts a request; when over the limit, the seconds until the window resets instead. */
  take(
    userId: string,
    now: Date,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const { limit, windowMs } = this.options;
    const at = now.getTime();
    if (this.counts.size > 10_000) this.forgetBefore(at - windowMs);
    const entry = this.counts.get(userId);
    if (!entry || at - entry.start >= windowMs) {
      this.counts.set(userId, { start: at, count: 1 });
      return { ok: true };
    }
    if (entry.count >= limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.ceil((entry.start + windowMs - at) / 1000),
      };
    }
    entry.count += 1;
    return { ok: true };
  }

  private forgetBefore(at: number): void {
    for (const [userId, entry] of this.counts) {
      if (entry.start < at) this.counts.delete(userId);
    }
  }
}
