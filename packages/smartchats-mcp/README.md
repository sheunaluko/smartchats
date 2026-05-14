# SmartChats MCP Server

Local MCP server that authenticates a SmartChats user via Firebase OAuth and exposes their data over the Model Context Protocol.

## Setup

```bash
cd packages/smartchats-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to your `.mcp.json` (project root or `~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "smartchats": {
      "command": "node",
      "args": ["packages/smartchats-mcp/dist/index.js"]
    }
  }
}
```

Or for development:

```json
{
  "mcpServers": {
    "smartchats": {
      "command": "npx",
      "args": ["tsx", "packages/smartchats-mcp/src/index.ts"]
    }
  }
}
```

## Authentication

On first run, the server opens a browser window for Firebase sign-in (Google or email/password). Credentials are stored in `~/.smartchats-mcp/credentials.json` and reused on subsequent runs.

To force re-authentication, delete the credentials file:

```bash
rm ~/.smartchats-mcp/credentials.json
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_logs` | Search logs by text substring, with optional category filter |
| `get_recent_logs` | Fetch N most recent logs, optionally filtered by category |
| `get_log_categories` | List all log categories with counts |
| `get_metrics` | Fetch metrics by name, category, or date range |
| `get_metrics_summary` | Aggregated overview of all tracked metrics |
| `query_knowledge_graph` | Search entities and relations by name |
| `get_todos` | Fetch todos by status (active/completed/cancelled/deferred) |
| `run_query` | Execute a raw SurrealQL SELECT query (read-only) |

## Architecture

```
MCP Client (Claude Code)
    ↕ stdio (JSON-RPC)
SmartChats MCP Server
    ↕ HTTPS + Firebase ID Token
Firebase Cloud Functions (surrealQuery)
    ↕ SurrealDB JSON-RPC
SurrealDB (user-scoped data)
```

All queries are scoped to the authenticated user by the Firebase Cloud Function layer.

## SurrealDB Tables

| Table | Content |
|-------|---------|
| `logs` | User journal entries (content, category, timestamps) |
| `metrics` | Quantified activities (metric_name, value, unit, timestamps) |
| `user_entities` | Knowledge graph nodes (name) |
| `user_relations` | Knowledge graph edges (sourceName, targetName, kind) |
| `user_data` | Multi-purpose records including todos (type, status, data) |
| `cortex` | Agent memory (procedural instructions) |
| `cortex_dynamic_functions` | User-defined agent functions |
