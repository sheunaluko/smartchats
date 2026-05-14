/**
 * MCP tool definitions for SmartChats.
 *
 * Each tool is a thin wrapper:
 *   1. Build a `QuerySpec` via `smartchats-database` query builders.
 *   2. Run via the active `DataAPIHandle.data.query` (cloud or local —
 *      target chosen at MCP startup via `--target`; same DataAPI shape
 *      either way).
 *   3. Return JSON-stringified rows on the MCP `content` channel.
 *
 * Import/export delegate to `smartchats-database/operations` —
 * the same code path the smartchats CLI uses, so user-data movement
 * is consistent across consumers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import {
    CloudClientStatementError,
    CloudClientHttpError,
} from "smartchats-cloud-client";
import {
    queries,
    operations,
    type QuerySpec,
    type Bundle,
} from "smartchats-database";
import {
    makeLocalDataAPI,
    type DataAPIHandle,
} from "smartchats-database/data-api";

function expandPath(p: string): string {
    if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
    return path.resolve(p);
}

/**
 * Format any error from the data layer into a plain message string.
 * Handles cloud-client error classes (when target='cloud') and plain
 * Errors (when target='local' — SDK throws wrap).
 */
function formatRunError(err: unknown): string {
    if (err instanceof CloudClientStatementError) {
        return `SurrealDB ERR (statement #${err.statementIndex}): ${err.message}\nQuery: ${err.query.slice(0, 200)}`;
    }
    if (err instanceof CloudClientHttpError) {
        return `Cloud Function HTTP ${err.status}: ${err.body.slice(0, 300)}`;
    }
    return (err as Error)?.message ?? String(err);
}

/**
 * Wrap a query-and-format flow in MCP-friendly error handling. Returns
 * the JSON-stringified rows on success, or the error message marked as
 * an MCP error on failure.
 */
async function runAndFormat(
    spec: QuerySpec,
    handle: DataAPIHandle,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    try {
        const result = await handle.data.query(spec);
        return {
            content: [{ type: "text" as const, text: JSON.stringify(result.rows, null, 2) }],
        };
    } catch (err) {
        return {
            content: [{ type: "text" as const, text: formatRunError(err) }],
            isError: true,
        };
    }
}

export interface RegisterToolsOptions {
    /** The active target — affects log lines + import/export bundle source. */
    target: "cloud" | "local";
    /** DataAPIHandle for the active target. All read tools route through this. */
    handle: DataAPIHandle;
}

/**
 * Register all SmartChats tools on the MCP server. Each tool is a thin
 * wrapper over a `smartchats-database` query builder + the active
 * DataAPI handle (cloud or local). The handle's transport is chosen via
 * `--target` at MCP startup; tools here don't branch on it.
 */
export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
    const { target, handle } = opts;

    // -------------------------------------------------------------------------
    // search_logs — substring search across user's logs
    // -------------------------------------------------------------------------
    server.tool(
        "search_logs",
        "Search the user's logs by text substring. Returns matching log entries with content, category, and timestamps. Use this to find logs mentioning specific topics, activities, or keywords.",
        {
            query: z.string().describe("Text to search for in log content (case-insensitive substring match)"),
            category: z.string().optional().describe("Filter by log category (e.g. 'exercise', 'water', 'general')"),
            limit: z.number().optional().describe("Maximum number of results to return (default: 20)"),
        },
        async ({ query, category, limit }) =>
            runAndFormat(queries.listLogs({ searchText: query, category, limit }), handle),
    );

    // -------------------------------------------------------------------------
    // get_recent_logs — most recent N logs
    // -------------------------------------------------------------------------
    server.tool(
        "get_recent_logs",
        "Fetch the most recent log entries, optionally filtered by category. Returns log content, category, and timestamps in reverse chronological order.",
        {
            category: z.string().optional().describe("Filter by log category (e.g. 'exercise', 'water', 'general')"),
            limit: z.number().optional().describe("Number of recent logs to fetch (default: 20, max: 100)"),
        },
        async ({ category, limit }) =>
            runAndFormat(queries.listLogs({ category, limit }), handle),
    );

    // -------------------------------------------------------------------------
    // get_log_categories — categories with counts
    // -------------------------------------------------------------------------
    server.tool(
        "get_log_categories",
        "List all log categories and how many logs are in each. Useful for understanding what kinds of data the user has logged.",
        {},
        async () => runAndFormat(queries.getLogCategories(), handle),
    );

    // -------------------------------------------------------------------------
    // get_metrics — tracked metrics with optional date range
    // -------------------------------------------------------------------------
    server.tool(
        "get_metrics",
        "Fetch tracked metrics (e.g. exercise reps, running distance, water intake). Can filter by metric name and date range. Returns metric values with timestamps and units.",
        {
            metric_name: z.string().optional().describe("Filter by metric name (e.g. 'pushups', 'running_distance', 'water_oz')"),
            category: z.string().optional().describe("Filter by category (e.g. 'exercise', 'nutrition')"),
            from_date: z.string().optional().describe("Start date in ISO format (e.g. '2026-03-01')"),
            to_date: z.string().optional().describe("End date in ISO format (e.g. '2026-03-31')"),
            limit: z.number().optional().describe("Maximum number of results (default: 50)"),
        },
        async (args) => runAndFormat(queries.getMetrics(args), handle),
    );

    // -------------------------------------------------------------------------
    // get_metrics_summary — aggregated overview + recent entries
    // -------------------------------------------------------------------------
    server.tool(
        "get_metrics_summary",
        "Get a summary of all tracked metrics: names, units, categories, entry counts, and min/max values. Also returns the 10 most recent metric entries. Useful for understanding what the user tracks.",
        {},
        async () => {
            try {
                const [summary, recent_entries] = await Promise.all([
                    handle.data.query(queries.getMetricsSummary()).then((r) => r.rows),
                    handle.data.query(queries.getRecentMetrics()).then((r) => r.rows),
                ]);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ summary, recent_entries }, null, 2),
                        },
                    ],
                };
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    // -------------------------------------------------------------------------
    // query_knowledge_graph — entities + relations by name
    // -------------------------------------------------------------------------
    server.tool(
        "query_knowledge_graph",
        "Search the user's knowledge graph for entities and relations by name. The knowledge graph stores facts as entity-relation-entity triples (e.g., 'shay' -created-> 'tidyscripts'). Returns matching entities and relations.",
        {
            query: z.string().describe("Search term to match against entity and relation names (substring match)"),
            limit: z.number().optional().describe("Maximum results per type (default: 20)"),
        },
        async ({ query, limit }) => {
            try {
                const [entities, relations] = await Promise.all([
                    handle.data.query(queries.searchEntitiesByName({ query, limit })).then((r) => r.rows),
                    handle.data.query(queries.searchRelationsByName({ query, limit })).then((r) => r.rows),
                ]);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ entities, relations }, null, 2),
                        },
                    ],
                };
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    // -------------------------------------------------------------------------
    // get_todos — active todos
    // -------------------------------------------------------------------------
    server.tool(
        "get_todos",
        "Fetch the user's active todos/tasks. Returns todo items with title, description, priority, category, due dates, and recurrence info.",
        {
            status: z
                .enum(["active", "completed", "cancelled", "deferred"])
                .optional()
                .describe("Filter by status (default: 'active')"),
            limit: z.number().optional().describe("Maximum number of results (default: 50)"),
        },
        async ({ status, limit }) =>
            runAndFormat(queries.getTodos({ status, limit }), handle),
    );

    // -------------------------------------------------------------------------
    // run_query — read-only raw SurrealQL passthrough
    // -------------------------------------------------------------------------
    server.tool(
        "run_query",
        "Execute a raw SurrealQL SELECT query scoped to the authenticated user. Only read operations are allowed. Use $variable placeholders for parameters. Tables available: logs, metrics, user_entities, user_relations, user_data, sessions.",
        {
            query: z.string().describe("SurrealQL query string (SELECT only). Use $variable placeholders for parameters."),
            variables: z
                .record(z.unknown())
                .optional()
                .describe("Key-value map of query variables to substitute for $placeholders"),
        },
        async ({ query: q, variables }) => {
            try {
                const spec = queries.buildRawQuery(q, variables ?? {});
                return await runAndFormat(spec, handle);
            } catch (err) {
                if (err instanceof queries.NonReadOnlyQueryError) {
                    return {
                        content: [{ type: "text" as const, text: err.message }],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    );

    // ───────────────────────────────────────────────────────────────────
    // export_user_data — dump active-target data to a JSON bundle.
    // Delegates to smartchats-database/operations.exportBundle so the
    // logic matches `smartchats data export`.
    // ───────────────────────────────────────────────────────────────────
    server.tool(
        "export_user_data",
        `Export user data from the active SurrealDB target (local AIO or cloud, set at MCP startup via --target) as a JSON bundle (logs, metrics, knowledge graph, app installs, etc.). Use to back up or migrate between local self-hosted and cloud instances. Returns a summary; the bundle is written to disk. Default tables: ${operations.DEFAULT_EXPORT_TABLES.join(", ")}.`,
        {
            output_path: z
                .string()
                .describe("File path to write the bundle to (e.g. '~/smartchats-export.json'). Required because bundles can be large."),
            tables: z
                .array(z.string())
                .optional()
                .describe(`Tables to export. Defaults to user-owned state: ${operations.DEFAULT_EXPORT_TABLES.join(", ")}.`),
            include_sensitive: z
                .boolean()
                .optional()
                .describe(`Also export sensitive/regenerable tables (${operations.SENSITIVE_TABLES.join(", ")}). Default false.`),
        },
        async ({ output_path, tables, include_sensitive }) => {
            try {
                const userId = await handle.getUid();
                const result = await operations.exportBundle(handle.data, {
                    source: target,
                    userId,
                    tables,
                    includeSensitive: include_sensitive,
                });

                const fullPath = expandPath(output_path);
                const text = JSON.stringify(result.bundle, null, 2);
                await fs.writeFile(fullPath, text, { mode: 0o600 });

                const totalRows = Object.values(result.bundle.tables).reduce(
                    (n, rows) => n + rows.length,
                    0,
                );
                const lines = [
                    `Exported ${totalRows} row(s) across ${Object.keys(result.bundle.tables).length} table(s) → ${fullPath}`,
                    `Bundle size: ${(text.length / 1024).toFixed(1)} KB`,
                    ``,
                    `Per-table counts:`,
                    ...result.perTable.map((t) =>
                        t.error
                            ? `  ${t.table}: ERROR — ${t.error}`
                            : `  ${t.table}: ${t.rows} row${t.rows === 1 ? "" : "s"}`,
                    ),
                ];
                if (result.blockedTables.length > 0) {
                    lines.push(``, `Skipped (telemetry — not portable across deployments): ${result.blockedTables.join(", ")}`);
                }
                return { content: [{ type: "text" as const, text: lines.join("\n") }] };
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    // ───────────────────────────────────────────────────────────────────
    // import_user_data — push a JSON bundle into a SurrealDB instance.
    //
    // Defaults to the active target. Per-call args (target_url etc.)
    // override for cross-environment imports — e.g., MCP started with
    // --target=cloud importing into a local AIO. Override path uses
    // SDK direct (root creds, not user JWT), since cross-env writes
    // typically want the operator's permissions.
    // ───────────────────────────────────────────────────────────────────
    server.tool(
        "import_user_data",
        "Import a previously-exported JSON bundle into a SurrealDB instance. Defaults to the active MCP target (cloud per-user JWT or local SDK direct based on startup --target). Per-call args (target_url, target_namespace, etc.) override for cross-environment imports — useful for backing up cloud → local or vice versa. Strategy is upsert-by-id.",
        {
            input_path: z
                .string()
                .describe("Path to the JSON bundle file written by export_user_data."),
            target_url: z
                .string()
                .optional()
                .describe("SurrealDB WebSocket URL override. When supplied, bypasses the active MCP target and connects SDK-direct to this URL with the supplied root creds."),
            target_namespace: z
                .string()
                .optional()
                .describe("Namespace override (default 'smartchats' for local target, 'production' for cloud)."),
            target_database: z
                .string()
                .optional()
                .describe("Database override (default 'main')."),
            target_user: z
                .string()
                .optional()
                .describe("Root username override (default 'root' for local SDK-direct path)."),
            target_password: z
                .string()
                .optional()
                .describe("Root password override (default 'root' for local SDK-direct path)."),
            tables: z
                .array(z.string())
                .optional()
                .describe("Subset of bundle tables to import. Default: all tables in the bundle."),
            dry_run: z
                .boolean()
                .optional()
                .describe("If true, parse + count rows but don't write anything. Default false."),
        },
        async ({
            input_path,
            target_url,
            target_namespace,
            target_database,
            target_user,
            target_password,
            tables,
            dry_run,
        }) => {
            try {
                const fullPath = expandPath(input_path);
                const text = await fs.readFile(fullPath, "utf8");
                const bundle = JSON.parse(text) as Bundle;

                if (bundle.version !== 1) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: `Unsupported bundle version: ${bundle.version}. This MCP supports v1.`,
                        }],
                        isError: true,
                    };
                }

                // Target resolution: explicit override → fresh local DataAPI
                // with the override params; else use the active handle.
                const explicitOverride =
                    target_url !== undefined ||
                    target_namespace !== undefined ||
                    target_database !== undefined ||
                    target_user !== undefined ||
                    target_password !== undefined;

                let activeHandle: DataAPIHandle = handle;
                let cleanup: () => Promise<void> = async () => undefined;
                let targetDescription: string;

                if (explicitOverride) {
                    try {
                        const overrideHandle = await makeLocalDataAPI({
                            url: target_url,
                            namespace: target_namespace,
                            database: target_database,
                            username: target_user,
                            password: target_password,
                        });
                        activeHandle = overrideHandle;
                        cleanup = () => overrideHandle.close();
                        targetDescription = `${overrideHandle.description} [explicit override]`;
                    } catch (err) {
                        return {
                            content: [{
                                type: "text" as const,
                                text: `import_user_data: failed to connect to override target: ${(err as Error).message}`,
                            }],
                            isError: true,
                        };
                    }
                } else {
                    targetDescription = `${handle.description} [MCP active target: ${target}]`;
                }

                try {
                    const result = await operations.importBundle(activeHandle.data, bundle, {
                        tables,
                        dryRun: dry_run,
                    });

                    const lines = [
                        dry_run
                            ? `[DRY RUN] Would import ${result.rowsInBundle} row(s) from ${fullPath}`
                            : `Imported ${result.rowsWritten}/${result.rowsInBundle} row(s) into ${targetDescription}`,
                        `Source: ${result.bundleSource}, exported: ${result.bundleExportedAt}, original userId: ${result.bundleUserId}`,
                        ``,
                        `Per-table counts:`,
                        ...result.perTable.map((t) => {
                            const errLine = t.firstError ? `  (first error: ${t.firstError.slice(0, 120)})` : "";
                            return `  ${t.table}: ${t.written}/${t.rows} written${t.failed ? ` (${t.failed} failed)${errLine}` : ""}`;
                        }),
                    ];
                    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
                } finally {
                    await cleanup();
                }
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );
}
