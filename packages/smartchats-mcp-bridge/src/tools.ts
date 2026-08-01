/**
 * MCP tool surface for the smartchats patch-through bridge.
 *
 * Four tools (Phase A):
 *   - send_message_to_user(text, artifacts?)
 *   - wait_for_message(timeout_ms?)
 *   - poll_messages(since?)
 *   - ask_user(question, timeout_ms?)
 *
 * Each tool is a thin wrapper — sends go through the injected AgentRelayClient;
 * receives read from the injected MessageQueue.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRelayClient } from './relay_client.js';
import type { MessageQueue, UserMessage } from './message_queue.js';

export interface RegisterToolsOptions {
  queue: MessageQueue;
  client: AgentRelayClient;
  /** Default wait timeout when the agent doesn't specify one. */
  defaultWaitTimeoutMs: number;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function formatMessage(msg: UserMessage): UserMessage {
  return { from: msg.from, text: msg.text, timestamp: msg.timestamp };
}

export interface ToolHandlers {
  send_message_to_user(args: { text: string; artifacts?: unknown[] }): Promise<ToolResult>;
  wait_for_message(args: { timeout_ms?: number }): Promise<ToolResult>;
  poll_messages(args: { since?: number }): Promise<ToolResult>;
  ask_user(args: { question: string; timeout_ms?: number }): Promise<ToolResult>;
}

/**
 * Pure handlers wired to the injected queue + client. Exposed separately from
 * `registerTools` so tests can drive them without an MCP server or transport.
 */
export function createToolHandlers(opts: RegisterToolsOptions): ToolHandlers {
  const { queue, client, defaultWaitTimeoutMs } = opts;

  return {
    async send_message_to_user({ text, artifacts }) {
      const ok = client.sendMessageToUser(text, artifacts);
      if (!ok) {
        return errorResult(
          'Not connected to smartchats-relay. Message dropped. Retry after connection is re-established.',
        );
      }
      return jsonResult({ sent: true });
    },

    async wait_for_message({ timeout_ms }) {
      const timeout = timeout_ms ?? defaultWaitTimeoutMs;
      const result = await queue.dequeue(timeout);
      if (result.timeout) return jsonResult({ timeout: true });
      return jsonResult(formatMessage(result.message));
    },

    async poll_messages({ since }) {
      const messages = queue.since(since).map(formatMessage);
      return jsonResult({ messages });
    },

    async ask_user({ question, timeout_ms }) {
      const sent = client.sendMessageToUser(question);
      if (!sent) {
        return errorResult(
          'Not connected to smartchats-relay. Question was not delivered.',
        );
      }
      const timeout = timeout_ms ?? defaultWaitTimeoutMs;
      const result = await queue.dequeue(timeout);
      if (result.timeout) return jsonResult({ timeout: true });
      return jsonResult(formatMessage(result.message));
    },
  };
}

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const handlers = createToolHandlers(opts);

  server.tool(
    'send_message_to_user',
    'Send a message from you (the agent) to the user via smartchats. The user hears it via TTS or reads it in the smartchats UI. Fire-and-forget — this tool does not wait for a reply. Use `ask_user` or `wait_for_message` to receive one.',
    {
      text: z.string().min(1).describe('The text to speak to the user.'),
      artifacts: z
        .array(z.unknown())
        .optional()
        .describe('Optional artifact references (reserved for later phases; ignored today).'),
    },
    handlers.send_message_to_user,
  );

  server.tool(
    'wait_for_message',
    'Block until the user sends a message to you, or the timeout fires. Returns the user\'s reply, or `{ timeout: true }` if no message arrives in time. Use this when you\'re "patched through" and expecting the user to respond.',
    {
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Max milliseconds to wait. Defaults to a moderate long-poll (~30s) so your outer tool-call loop can breathe between checks.',
        ),
    },
    handlers.wait_for_message,
  );

  server.tool(
    'poll_messages',
    'Non-blocking peek of user messages retained in history. Returns any messages whose timestamp is strictly greater than `since`. Omit `since` to get the full retained history (bounded).',
    {
      since: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Unix-ms timestamp; only messages after this are returned.'),
    },
    handlers.poll_messages,
  );

  server.tool(
    'ask_user',
    'Ask the user a question and block for their reply. Convenience wrapper — equivalent to `send_message_to_user(question)` followed by `wait_for_message(timeout_ms)`.',
    {
      question: z.string().min(1).describe('The question to speak to the user.'),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max milliseconds to wait for the reply. Defaults to the same long-poll as wait_for_message.'),
    },
    handlers.ask_user,
  );
}
