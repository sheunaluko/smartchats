#!/usr/bin/env node
/**
 * smartchats-mcp-bridge — stdio MCP server that lets any MCP-speaking coding
 * agent send messages to and receive messages from the smartchats user via
 * the smartchats-relay.
 *
 * Runs as a stdio subprocess of the coding agent (Claude Code, Codex, aider,
 * Gemini CLI, ...). Exposes four tools (see ./tools.ts) that the agent can
 * call as part of its normal tool-use loop.
 *
 * Logs to stderr — stdout is reserved for the MCP JSON-RPC transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveBridgeConfig } from './config.js';
import { MessageQueue } from './message_queue.js';
import { startAgentRelayClient } from './relay_client.js';
import { registerTools } from './tools.js';

const logger = {
  info: (m: string) => console.error(`\x1b[96m[agent]\x1b[0m ${m}`),
  error: (m: string) => console.error(`\x1b[91m[agent]\x1b[0m ${m}`),
};

async function main(): Promise<void> {
  const config = resolveBridgeConfig();
  logger.info(`label="${config.label}" relay=${config.relayUrl}`);

  const queue = new MessageQueue();

  // Fire-and-forget: the relay client's own connect() runs in the background
  // via the relay-connect helper. Tools remain callable during (re)connect;
  // send returns false and dequeue times out normally.
  const client = await startAgentRelayClient({ config, queue, logger });

  const server = new McpServer({
    name: 'smartchats-mcp-bridge',
    version: '0.1.0',
  });

  registerTools(server, {
    queue,
    client,
    defaultWaitTimeoutMs: config.defaultWaitTimeoutMs,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP server running on stdio.');

  const shutdown = (sig: string): void => {
    logger.info(`received ${sig}; closing...`);
    client.close();
    queue.reset();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
