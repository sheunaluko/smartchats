import { describe, test, expect, beforeEach, vi } from 'vitest';
import { MessageQueue } from '../src/message_queue.js';
import { createToolHandlers, type ToolHandlers } from '../src/tools.js';
import type { AgentRelayClient } from '../src/relay_client.js';

function parseResult(r: Awaited<ReturnType<ToolHandlers['send_message_to_user']>>): {
  data: unknown;
  isError: boolean;
} {
  return {
    data: JSON.parse(r.content[0].text),
    isError: r.isError ?? false,
  };
}

interface MockClient extends AgentRelayClient {
  readonly sent: Array<{ text: string; artifacts: unknown[] | undefined }>;
}

function makeMockClient({ connected = true } = {}): MockClient {
  const sent: MockClient['sent'] = [];
  return {
    get sessionId() { return connected ? 'sid-test' : null; },
    get connected() { return connected; },
    sendMessageToUser: vi.fn((text: string, artifacts?: unknown[]) => {
      if (!connected) return false;
      sent.push({ text, artifacts });
      return true;
    }),
    close: vi.fn(),
    sent,
  } as MockClient;
}

describe('tool handlers', () => {
  let queue: MessageQueue;
  let client: MockClient;
  let handlers: ToolHandlers;

  beforeEach(() => {
    queue = new MessageQueue();
    client = makeMockClient();
    handlers = createToolHandlers({ queue, client, defaultWaitTimeoutMs: 100 });
  });

  test('send_message_to_user forwards to client and returns { sent: true }', async () => {
    const r = parseResult(await handlers.send_message_to_user({ text: 'hi' }));
    expect(r.isError).toBe(false);
    expect(r.data).toEqual({ sent: true });
    expect(client.sent).toEqual([{ text: 'hi', artifacts: undefined }]);
  });

  test('send_message_to_user returns error result when client disconnected', async () => {
    const disconnected = makeMockClient({ connected: false });
    const h = createToolHandlers({ queue, client: disconnected, defaultWaitTimeoutMs: 100 });
    const r = await h.send_message_to_user({ text: 'hi' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Not connected/);
  });

  test('wait_for_message returns the message when one is buffered', async () => {
    queue.enqueue({ from: 'user', text: 'yo', timestamp: 42 });
    const r = parseResult(await handlers.wait_for_message({}));
    expect(r.data).toEqual({ from: 'user', text: 'yo', timestamp: 42 });
  });

  test('wait_for_message returns { timeout: true } past the timeout', async () => {
    const r = parseResult(await handlers.wait_for_message({ timeout_ms: 30 }));
    expect(r.data).toEqual({ timeout: true });
  });

  test('wait_for_message honors defaultWaitTimeoutMs when timeout_ms omitted', async () => {
    // defaultWaitTimeoutMs = 100 from beforeEach; verify we time out around then
    // rather than waiting indefinitely.
    const start = Date.now();
    const r = parseResult(await handlers.wait_for_message({}));
    const elapsed = Date.now() - start;
    expect(r.data).toEqual({ timeout: true });
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(300);
  });

  test('poll_messages returns history filtered by since', async () => {
    queue.enqueue({ from: 'user', text: 'a', timestamp: 10 });
    queue.enqueue({ from: 'user', text: 'b', timestamp: 20 });
    const r = parseResult(await handlers.poll_messages({ since: 15 }));
    expect((r.data as { messages: unknown[] }).messages).toEqual([
      { from: 'user', text: 'b', timestamp: 20 },
    ]);
  });

  test('ask_user sends the question and waits for reply', async () => {
    setTimeout(() => queue.enqueue({ from: 'user', text: 'sure', timestamp: 5 }), 10);
    const r = parseResult(await handlers.ask_user({ question: 'ok?' }));
    expect(client.sent).toEqual([{ text: 'ok?', artifacts: undefined }]);
    expect(r.data).toEqual({ from: 'user', text: 'sure', timestamp: 5 });
  });

  test('ask_user returns error when client disconnected and does not wait', async () => {
    const disconnected = makeMockClient({ connected: false });
    const h = createToolHandlers({ queue, client: disconnected, defaultWaitTimeoutMs: 100 });
    const start = Date.now();
    const r = await h.ask_user({ question: 'ok?' });
    const elapsed = Date.now() - start;
    expect(r.isError).toBe(true);
    expect(elapsed).toBeLessThan(50); // did not wait for reply
  });
});
