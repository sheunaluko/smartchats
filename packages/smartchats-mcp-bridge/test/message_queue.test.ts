import { describe, test, expect } from 'vitest';
import { MessageQueue, type UserMessage } from '../src/message_queue.js';

function u(text: string, ts: number): UserMessage {
  return { from: 'user', text, timestamp: ts };
}

describe('MessageQueue', () => {
  test('enqueue-then-dequeue returns the buffered message', async () => {
    const q = new MessageQueue();
    q.enqueue(u('hello', 1));
    const r = await q.dequeue(1000);
    expect(r.timeout).toBeUndefined();
    expect(r.message).toEqual(u('hello', 1));
  });

  test('dequeue-then-enqueue resolves the waiter with the message', async () => {
    const q = new MessageQueue();
    const p = q.dequeue(1000);
    q.enqueue(u('world', 2));
    const r = await p;
    expect(r.message).toEqual(u('world', 2));
  });

  test('dequeue with short timeout returns { timeout: true }', async () => {
    const q = new MessageQueue();
    const r = await q.dequeue(30);
    expect(r).toEqual({ timeout: true });
  });

  test('dequeue with no timeout blocks until enqueue', async () => {
    const q = new MessageQueue();
    let resolved = false;
    const p = q.dequeue().then((r) => { resolved = true; return r; });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    q.enqueue(u('late', 3));
    const r = await p;
    expect(r.message?.text).toBe('late');
  });

  test('FIFO ordering when multiple messages arrive before dequeue', async () => {
    const q = new MessageQueue();
    q.enqueue(u('a', 1));
    q.enqueue(u('b', 2));
    q.enqueue(u('c', 3));
    const r1 = await q.dequeue(1000);
    const r2 = await q.dequeue(1000);
    const r3 = await q.dequeue(1000);
    expect([r1.message?.text, r2.message?.text, r3.message?.text]).toEqual(['a', 'b', 'c']);
  });

  test('since() returns messages with timestamp strictly greater than since', () => {
    const q = new MessageQueue();
    q.enqueue(u('a', 10));
    q.enqueue(u('b', 20));
    q.enqueue(u('c', 30));
    expect(q.since(15).map((m) => m.text)).toEqual(['b', 'c']);
    expect(q.since(30).map((m) => m.text)).toEqual([]);
    expect(q.since(undefined).map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  test('history is bounded by maxHistory', () => {
    const q = new MessageQueue({ maxHistory: 2 });
    q.enqueue(u('a', 1));
    q.enqueue(u('b', 2));
    q.enqueue(u('c', 3));
    expect(q.since(0).map((m) => m.text)).toEqual(['b', 'c']);
  });

  test('reset() cancels waiters with { timeout: true }', async () => {
    const q = new MessageQueue();
    const p = q.dequeue(1000);
    q.reset();
    const r = await p;
    expect(r).toEqual({ timeout: true });
    expect(q.bufferedCount).toBe(0);
    expect(q.waiterCount).toBe(0);
  });
});
