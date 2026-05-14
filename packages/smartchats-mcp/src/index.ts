#!/usr/bin/env node
/**
 * SmartChats MCP server entry point.
 *
 * Listens on stdio and exposes a set of read tools (logs, metrics,
 * knowledge graph, todos, raw query) plus user-data import/export.
 * All tools route through a single `DataAPIHandle` (cloud or local —
 * chosen at startup via `--target`) constructed via the same
 * `makeDataAPI` factories the smartchats CLI uses. One contract, one
 * shape — read tools are target-agnostic, no per-tool branching.
 *
 * Cloud target uses Firebase OAuth (cached refresh-token flow) →
 * Cloud Function `surrealQuery` → user-scoped SurrealDB. Same
 * credentials file as the CLI (`~/.smartchats-mcp/credentials.json`),
 * so logging in once via `smartchats login` makes the MCP server
 * authenticated too.
 *
 * Local target uses SDK direct WebSocket to the AIO's exposed
 * SurrealDB on ws://localhost:8000/rpc with root creds (single-user,
 * no auth gate).
 *
 * Cross-environment imports (e.g., MCP started in cloud mode but
 * importing a bundle into your local AIO) work via the
 * `import_user_data` tool's per-call override args.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig, getIdToken } from "smartchats-cloud-client";
import {
    makeCloudDataAPI,
    makeLocalDataAPI,
    type DataAPIHandle,
    type Target,
} from "smartchats-database/data-api";
import { registerTools } from "./tools.js";

interface CliArgs {
    target: Target;
    localUrl: string;
    localNs: string;
    localDb: string;
    localUser: string;
    localPassword: string;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        target: "cloud",
        localUrl: process.env.SMARTCHATS_MCP_LOCAL_URL ?? "ws://localhost:8000/rpc",
        localNs: process.env.SMARTCHATS_MCP_LOCAL_NS ?? "smartchats",
        localDb: process.env.SMARTCHATS_MCP_LOCAL_DB ?? "main",
        localUser: process.env.SMARTCHATS_MCP_LOCAL_USER ?? "root",
        localPassword: process.env.SMARTCHATS_MCP_LOCAL_PASSWORD ?? "root",
    };
    for (let i = 0; i < argv.length; i++) {
        const raw = argv[i];
        // Support both `--flag value` and `--flag=value` forms.
        let flag = raw;
        let inlineValue: string | undefined;
        if (raw.startsWith("--") && raw.includes("=")) {
            const eq = raw.indexOf("=");
            flag = raw.slice(0, eq);
            inlineValue = raw.slice(eq + 1);
        }
        const next = () => (inlineValue !== undefined ? inlineValue : argv[++i]);
        switch (flag) {
            case "--target": {
                const t = next();
                if (t !== "cloud" && t !== "local") {
                    console.error(`[smartchats-mcp] Invalid --target '${t}' (expected 'cloud' or 'local')`);
                    process.exit(1);
                }
                args.target = t;
                break;
            }
            case "--local-url":      args.localUrl = next(); break;
            case "--local-ns":       args.localNs = next(); break;
            case "--local-db":       args.localDb = next(); break;
            case "--local-user":     args.localUser = next(); break;
            case "--local-password": args.localPassword = next(); break;
            case "-h":
            case "--help":
                console.error(getHelpText());
                process.exit(0);
                break;
            default:
                console.error(`[smartchats-mcp] Unknown argument: ${raw}`);
                console.error(getHelpText());
                process.exit(1);
        }
    }
    return args;
}

function getHelpText(): string {
    return `SmartChats MCP Server

Usage:
  smartchats-mcp [options]

Options:
  --target <local|cloud>   Which SurrealDB to connect to. Default 'cloud'.
                           cloud: Firebase OAuth → smartchats.ai SaaS
                           local: AIO's exposed SurrealDB (root creds, single-tenant)

  Local-mode-only:
  --local-url <ws-url>     SurrealDB WebSocket URL (default ws://localhost:8000/rpc)
  --local-ns <namespace>   Namespace (default 'smartchats')
  --local-db <database>    Database (default 'main')
  --local-user <name>      Root username (default 'root')
  --local-password <pw>    Root password (default 'root')

  -h, --help               Show this help

Env-var equivalents (lower precedence than flags):
  SMARTCHATS_MCP_LOCAL_URL, SMARTCHATS_MCP_LOCAL_NS, SMARTCHATS_MCP_LOCAL_DB,
  SMARTCHATS_MCP_LOCAL_USER, SMARTCHATS_MCP_LOCAL_PASSWORD
`;
}

async function buildHandle(args: CliArgs): Promise<DataAPIHandle> {
    if (args.target === "cloud") {
        const config = resolveConfig();
        // Pre-authenticate before stdio transport takes over stdin/stdout.
        // The browser-login flow needs interactive output; once stdio
        // transport is active, all stdout writes belong to the MCP
        // JSON-RPC protocol.
        console.error("[smartchats-mcp] target=cloud — authenticating with Firebase...");
        try {
            await getIdToken(config);
            console.error("[smartchats-mcp] Authenticated successfully.");
        } catch (err) {
            console.error(`[smartchats-mcp] Authentication failed: ${err}`);
            process.exit(1);
        }
        return makeCloudDataAPI({ config });
    }

    // Local target — SDK-direct WebSocket. Connection happens here so
    // failures surface before the server starts accepting MCP requests.
    console.error(
        `[smartchats-mcp] target=local — connecting to ${args.localUrl} (${args.localNs}/${args.localDb})...`,
    );
    try {
        const handle = await makeLocalDataAPI({
            url: args.localUrl,
            namespace: args.localNs,
            database: args.localDb,
            username: args.localUser,
            password: args.localPassword,
        });
        console.error("[smartchats-mcp] Connected to local SurrealDB.");
        return handle;
    } catch (err) {
        console.error(`[smartchats-mcp] Local connect failed: ${(err as Error).message}`);
        process.exit(1);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const handle = await buildHandle(args);

    const server = new McpServer({
        name: "smartchats-mcp",
        version: "1.0.0",
    });

    registerTools(server, { target: args.target, handle });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(
        `[smartchats-mcp] Server running on stdio transport (target=${args.target}).`,
    );

    // Graceful shutdown — release the handle's connection on SIGINT/SIGTERM.
    const shutdown = async (sig: string) => {
        console.error(`[smartchats-mcp] received ${sig}; closing handle...`);
        await handle.close().catch(() => undefined);
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
    console.error(`[smartchats-mcp] Fatal error: ${err}`);
    process.exit(1);
});
