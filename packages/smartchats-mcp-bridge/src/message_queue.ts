/**
 * Async message queue between the relay-side reader (enqueue) and the MCP
 * `wait_for_message` / `poll_messages` tools (dequeue / since).
 *
 * - If a message arrives with no waiter, it's buffered until a waiter picks it up.
 * - If a waiter is registered when a message arrives, it's delivered immediately.
 * - Waiters can specify a timeout; on timeout the promise resolves with `{ timeout: true }`.
 * - A bounded history buffer supports `poll_messages(since)` (non-blocking peek).
 */

export interface UserMessage {
  from: 'user';
  text: string;
  timestamp: number;
}

export type DequeueResult =
  | { message: UserMessage; timeout?: undefined }
  | { message?: undefined; timeout: true };

interface Waiter {
  resolve(result: DequeueResult): void;
  timer: NodeJS.Timeout | null;
}

export interface MessageQueueOptions {
  /** Max messages retained for `poll_messages(since)`. Default: 200. */
  maxHistory?: number;
}

export class MessageQueue {
  private waiters: Waiter[] = [];
  private buffered: UserMessage[] = [];
  private history: UserMessage[] = [];
  private readonly maxHistory: number;

  constructor(opts: MessageQueueOptions = {}) {
    this.maxHistory = opts.maxHistory ?? 200;
  }

  enqueue(msg: UserMessage): void {
    this.history.push(msg);
    if (this.history.length > this.maxHistory) this.history.shift();

    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ message: msg });
    } else {
      this.buffered.push(msg);
    }
  }

  /**
   * Wait for the next message. If one is already buffered, resolves synchronously
   * on the next tick. Otherwise blocks until a message arrives or the timeout fires.
   * A `timeoutMs` of 0 or undefined means wait indefinitely.
   */
  dequeue(timeoutMs?: number): Promise<DequeueResult> {
    const buffered = this.buffered.shift();
    if (buffered) return Promise.resolve({ message: buffered });

    return new Promise<DequeueResult>((resolve) => {
      const waiter: Waiter = { resolve, timer: null };
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          resolve({ timeout: true });
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  /** Non-blocking peek. Returns all history messages with timestamp > since (or all if since is null). */
  since(since: number | null | undefined): UserMessage[] {
    if (since == null) return [...this.history];
    return this.history.filter((m) => m.timestamp > since);
  }

  /** How many messages are buffered awaiting a dequeue call. */
  get bufferedCount(): number {
    return this.buffered.length;
  }

  /** How many waiters are currently blocked in dequeue. */
  get waiterCount(): number {
    return this.waiters.length;
  }

  /** Cancel all pending waiters (they resolve with { timeout: true }) and clear state. Test/teardown helper. */
  reset(): void {
    for (const w of this.waiters) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve({ timeout: true });
    }
    this.waiters = [];
    this.buffered = [];
    this.history = [];
  }
}
