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
    callCloudFunction,
    type CloudClientConfig,
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
import {
    nowEventTime,
    eventTimeFromOverride,
} from "./event_time.js";

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
    /**
     * Cloud client config — present when target='cloud'. Used by the
     * semantic-search tools to call the `openaiEmbedding` callable directly
     * (the DataAPI handle only exposes the `surrealQuery` path).
     */
    cloudConfig?: CloudClientConfig;
    /**
     * Base URL for the local Express server's API mount (e.g.
     * `http://localhost:3000/local-api`). Used by semantic-search tools when
     * target='local' to POST {base}/embeddings/embed.
     */
    localServerUrl: string;
}

/**
 * Generate an embedding vector for the given text. Branches on target:
 *   cloud → callable `openaiEmbedding` (does its own balance check + post-charge).
 *   local → POST {localServerUrl}/embeddings/embed (Express resolves the
 *           OpenAI key from env or the BYO-keys table).
 *
 * Errors are formatted so the caller can surface them as MCP tool errors
 * without leaking internals.
 */
async function embedQueryText(
    text: string,
    target: "cloud" | "local",
    cloudConfig: CloudClientConfig | undefined,
    localServerUrl: string,
): Promise<number[]> {
    if (target === "cloud") {
        if (!cloudConfig) {
            throw new Error("embedQueryText: cloud target but no cloudConfig provided");
        }
        const res = await callCloudFunction<{ success: boolean; embedding: number[] }>(
            "openaiEmbedding",
            { text },
            cloudConfig,
        );
        if (!res?.embedding || !Array.isArray(res.embedding)) {
            throw new Error("openaiEmbedding returned no embedding");
        }
        return res.embedding;
    }

    // Local target — POST to Express.
    const url = `${localServerUrl.replace(/\/$/, "")}/embeddings/embed`;
    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
    } catch (err) {
        throw new Error(
            `Can't reach local embed endpoint at ${url} (${(err as Error).message}). ` +
            `Start the local server (bin/aio or bin/devserve) or set SMARTCHATS_MCP_LOCAL_SERVER_URL.`,
        );
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`embed endpoint returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { embedding?: number[]; error?: string };
    if (json.error) throw new Error(`embed endpoint error: ${json.error}`);
    if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error("embed endpoint returned no embedding");
    }
    return json.embedding;
}

/**
 * Register all SmartChats tools on the MCP server. Each tool is a thin
 * wrapper over a `smartchats-database` query builder + the active
 * DataAPI handle (cloud or local). The handle's transport is chosen via
 * `--target` at MCP startup; tools here don't branch on it.
 */
export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
    const { target, handle, cloudConfig, localServerUrl } = opts;

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
    // semantic_search_logs — KNN over log embeddings
    // -------------------------------------------------------------------------
    server.tool(
        "semantic_search_logs",
        "Semantic (vector) search across the user's logs. Embeds the query text via the active target's embed endpoint (OpenAI text-embedding-3-small), then runs KNN against the `embedding` column on `logs`. Returns the closest matches by cosine distance, with optional category filter. Use this when substring search (`search_logs`) would miss conceptually-related entries — e.g. searching 'feeling stuck' to surface logs about creative blocks, frustration, plateaus.",
        {
            query: z.string().describe("Natural-language query. Will be embedded and matched semantically against log content."),
            category: z.string().optional().describe("Optional category filter applied alongside the vector match."),
            limit: z.number().optional().describe("Number of nearest neighbors to return (default 10)."),
            effort: z.number().optional().describe("HNSW search effort. Higher = more accurate but slower. Default 40."),
        },
        async ({ query, category, limit, effort }) => {
            try {
                const embedding = await embedQueryText(query, target, cloudConfig, localServerUrl);
                const spec = queries.searchLogsSemantic({
                    embedding,
                    category,
                    limit: limit ?? 10,
                    effort,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
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
    // get_metrics_summary — aggregated overview + latest entry per metric
    // -------------------------------------------------------------------------
    // Replaces a previous shape that paired the summary with an unbounded
    // SELECT * FROM metrics ORDER BY ts DESC ("10 most recent metric entries"
    // by description, but no LIMIT in the query — actually returned all rows,
    // ~127K tokens on a 1456-row DB). Same fix the in-app loader got in the
    // open repo at c6ffb18: one row per distinct metric_name, populated with
    // that metric's most recent value. Compact + useful instead of bloated.
    server.tool(
        "get_metrics_summary",
        "Get a summary of all tracked metrics: names, units, categories, entry counts, min/max values. Also returns one row per tracked metric showing its most recent value (`latest_per_metric`: { metric_name, value, unit, category, ts, local_date, source }). Useful for understanding what the user tracks and the current state of each metric.",
        {},
        async () => {
            try {
                const [summary, latest_per_metric] = await Promise.all([
                    handle.data.query(queries.getMetricsSummary()).then((r) => r.rows),
                    handle.data.query(queries.getLatestMetricPerName()).then((r) => r.rows),
                ]);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ summary, latest_per_metric }, null, 2),
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
        "Search the user's knowledge graph for entities and relations by name. The knowledge graph stores facts as entity-relation-entity triples (e.g., 'alice' -authored-> 'paper_x'). Returns matching entities and relations.",
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
    // semantic_search_entities — KNN over knowledge-graph entities
    // -------------------------------------------------------------------------
    server.tool(
        "semantic_search_entities",
        "Semantic (vector) search across the user's knowledge-graph entities by name. Embeds the query text, runs KNN against `user_entities.embedding`. Returns entities ranked by cosine distance — useful when you don't know the exact name (e.g. 'meditation teacher' → finds 'Tara Brach', 'Joseph Goldstein').",
        {
            query: z.string().describe("Natural-language query for the entity. Embedded and matched against entity-name embeddings."),
            limit: z.number().optional().describe("Number of nearest neighbors to return (default 10)."),
            effort: z.number().optional().describe("HNSW search effort. Higher = more accurate but slower. Default 40."),
        },
        async ({ query, limit, effort }) => {
            try {
                const embedding = await embedQueryText(query, target, cloudConfig, localServerUrl);
                const spec = queries.knnSearchEntities({
                    embedding,
                    limit: limit ?? 10,
                    effort: effort ?? 40,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    // -------------------------------------------------------------------------
    // semantic_search_relations — KNN over knowledge-graph relations
    // -------------------------------------------------------------------------
    server.tool(
        "semantic_search_relations",
        "Semantic (vector) search across the user's knowledge-graph relations (entity-relation-entity triples). Embeds the query text, runs KNN against `user_relations.embedding`. Returns full triples (sourceName, kind, targetName) ranked by cosine distance. Useful for finding facts when you know the gist but not the exact wording.",
        {
            query: z.string().describe("Natural-language query describing the relation. Embedded and matched against relation embeddings."),
            limit: z.number().optional().describe("Number of nearest neighbors to return (default 10)."),
            effort: z.number().optional().describe("HNSW search effort. Higher = more accurate but slower. Default 40."),
        },
        async ({ query, limit, effort }) => {
            try {
                const embedding = await embedQueryText(query, target, cloudConfig, localServerUrl);
                const spec = queries.knnSearchRelations({
                    embedding,
                    limit: limit ?? 10,
                    effort: effort ?? 40,
                });
                return await runAndFormat(spec, handle);
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
            page_size: z
                .number()
                .int()
                .min(1)
                .max(500)
                .optional()
                .describe("Rows per paginated fetch. Default 100. Lower (e.g. 25) if a wide table (logs with embeddings) trips a response-size / timeout cap and the per-table export errors out mid-stream."),
        },
        async ({ output_path, tables, include_sensitive, page_size }) => {
            try {
                const userId = await handle.getUid();
                const result = await operations.exportBundle(handle.data, {
                    source: target,
                    userId,
                    tables,
                    includeSensitive: include_sensitive,
                    pageSize: page_size,
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
                    const importLogs: string[] = [];
                    const result = await operations.importBundle(activeHandle.data, bundle, {
                        tables,
                        dryRun: dry_run,
                        onLog: (msg) => importLogs.push(msg),
                    });

                    // Post-import schema convergence. Local targets carry their
                    // own schema lifecycle (via applyLocalSchema) — call it so
                    // any rows that arrived without post-migration fields get
                    // backfilled by the idempotent migration block. Cloud
                    // targets omit applySchema (cloud server manages schema).
                    let convergenceNote = "";
                    if (!dry_run && activeHandle.applySchema) {
                        try {
                            await activeHandle.applySchema();
                            convergenceNote = "Post-import schema convergence: applied.";
                        } catch (err) {
                            convergenceNote = `Post-import schema convergence: FAILED — ${(err as Error).message}`;
                        }
                    }

                    const lines = [
                        dry_run
                            ? `[DRY RUN] Would import ${result.rowsInBundle} row(s) from ${fullPath}`
                            : `Imported ${result.rowsWritten}/${result.rowsInBundle} row(s) into ${targetDescription}`,
                        `Source: ${result.bundleSource}, exported: ${result.bundleExportedAt}, original userId: ${result.bundleUserId}`,
                        ...(importLogs.length > 0 ? ["", "Import notes:", ...importLogs.map((m) => `  ${m}`)] : []),
                        ...(convergenceNote ? ["", convergenceNote] : []),
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

    // =====================================================================
    // WRITE TOOLS
    // =====================================================================
    // All writes auto-stamp the event-time triple (ts / local_date /
    // local_tz) via event_time.ts so MCP-initiated writes obey the
    // schema's mandatory v1.0.0 fields. Inserts that touch embedded
    // columns auto-embed via embedQueryText so callers never pass
    // vectors by hand.

    // ── Logs ────────────────────────────────────────────────────────────

    server.tool(
        "insert_log",
        "Insert a new journal log entry. Auto-embeds the content (text-embedding-3-small) and stamps the event-time triple (ts/local_date/local_tz) using the system tz. Use this to record dreams, reflections, software updates, or any journal entry mid-conversation. Pass event_time_override to backfill an entry that happened earlier (accepts YYYY-MM-DD or ISO datetime).",
        {
            content: z.string().describe("Free-text content of the log entry."),
            category: z.string().describe("Category to file under (e.g. 'dreams', 'exercise', 'software updates'). Lowercased on insert."),
            event_time_override: z
                .string()
                .optional()
                .describe("Optional: stamp the entry as having happened at this time instead of now. YYYY-MM-DD (anchors at noon local) or full ISO datetime."),
        },
        async ({ content, category, event_time_override }) => {
            try {
                const embedding = await embedQueryText(content, target, cloudConfig, localServerUrl);
                const eventTime = event_time_override
                    ? eventTimeFromOverride(event_time_override)
                    : nowEventTime();
                const spec = queries.insertLog({
                    content,
                    category: category.toLowerCase(),
                    embedding,
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "update_log",
        "Update an existing log entry. If `content` is in the patch, the embedding is automatically re-generated so semantic search stays accurate. Pass any subset of fields; omitted fields are left untouched.",
        {
            id: z.string().describe("Full record id of the log (e.g. 'logs:abc123')."),
            content: z.string().optional().describe("New content. Triggers re-embedding."),
            category: z.string().optional().describe("New category."),
        },
        async ({ id, content, category }) => {
            try {
                const patch: { content?: string; category?: string; embedding?: number[] } = {};
                if (content !== undefined) {
                    patch.content = content;
                    patch.embedding = await embedQueryText(content, target, cloudConfig, localServerUrl);
                }
                if (category !== undefined) patch.category = category.toLowerCase();
                const spec = queries.updateLog({ recordId: id, patch });
                if (!spec) {
                    return {
                        content: [{ type: "text" as const, text: "update_log: nothing to update (no content or category supplied)" }],
                        isError: true,
                    };
                }
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "delete_log",
        "Delete a log entry by id. Returns the deleted row (RETURN BEFORE) so the caller can confirm what was removed. Logs are otherwise append-only — use this only for cleanup of garbled / test entries. Verify the id with search_logs or get_recent_logs first.",
        {
            id: z.string().describe("Full record id of the log (e.g. 'logs:abc123')."),
        },
        async ({ id }) =>
            runAndFormat(queries.deleteLog(id), handle),
    );

    server.tool(
        "prepare_log_category",
        "Register a new log category the user wants to track but hasn't logged any entries for yet. Surfaces in get_log_categories with count: 0. No-op if the category already has entries or is already prepared.",
        {
            category: z.string().describe("Category name (will be lowercased)."),
            description: z.string().describe("Short description of what this category is for."),
        },
        async ({ category, description }) =>
            runAndFormat(
                queries.insertPreparedLogCategory({ category: category.toLowerCase(), description }),
                handle,
            ),
    );

    // ── Metrics ────────────────────────────────────────────────────────────

    server.tool(
        "insert_metric",
        "Log a tracked metric value (e.g. weight, exercise reps, water intake). Stamps the event-time triple via the system tz. Pass event_time_override to backfill ('I weighed 195 yesterday'). Source defaults to 'mcp' so MCP-originated entries are distinguishable in audits.",
        {
            metric_name: z.string().describe("Name of the metric (e.g. 'weight', 'pushups', 'water_oz')."),
            value: z.number().describe("Numeric value of the entry."),
            unit: z.string().describe("Unit string (e.g. 'lbs', 'reps', 'oz')."),
            metric_type: z.string().describe("Metric type — e.g. 'gauge', 'counter', 'duration'. Free-form."),
            category: z.string().optional().describe("Category bucket (default: 'general')."),
            note: z.string().optional().describe("Optional note about this specific entry."),
            source_text: z.string().optional().describe("Optional source text (the user's original phrasing)."),
            event_time_override: z
                .string()
                .optional()
                .describe("Backfill timestamp: YYYY-MM-DD or full ISO datetime."),
        },
        async ({ metric_name, value, unit, metric_type, category, note, source_text, event_time_override }) => {
            try {
                const eventTime = event_time_override
                    ? eventTimeFromOverride(event_time_override)
                    : nowEventTime();
                const spec = queries.insertMetric({
                    metric_name,
                    value,
                    unit,
                    metric_type,
                    source: "mcp",
                    source_text: source_text ?? "",
                    source_log_id: null,
                    category: category ?? "general",
                    time_shift_quantity: null,
                    time_shift_unit: null,
                    note: note ?? null,
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "update_metric",
        "Update a metric entry by id. Whitelisted patch fields: value, category, note, source_text. metric_name / unit / metric_type are NOT editable — changing them means it's a different metric (delete + re-insert instead).",
        {
            id: z.string().describe("Full record id of the metric (e.g. 'metrics:abc123')."),
            value: z.number().optional().describe("New numeric value."),
            category: z.string().optional().describe("New category."),
            note: z.string().optional().describe("New note (pass empty string to clear)."),
            source_text: z.string().optional().describe("New source_text."),
        },
        async ({ id, value, category, note, source_text }) => {
            const patch: { value?: number; category?: string; note?: string | null; source_text?: string } = {};
            if (value !== undefined) patch.value = value;
            if (category !== undefined) patch.category = category;
            if (note !== undefined) patch.note = note;
            if (source_text !== undefined) patch.source_text = source_text;
            const spec = queries.updateMetric({ recordId: id, patch });
            if (!spec) {
                return {
                    content: [{ type: "text" as const, text: "update_metric: nothing to update (no settable field supplied)" }],
                    isError: true,
                };
            }
            return await runAndFormat(spec, handle);
        },
    );

    server.tool(
        "delete_metric",
        "Delete a metric entry by id. Returns the deleted row (RETURN BEFORE). Verify the id via get_metrics first.",
        {
            id: z.string().describe("Full record id of the metric (e.g. 'metrics:abc123')."),
        },
        async ({ id }) =>
            runAndFormat(queries.deleteMetric(id), handle),
    );

    server.tool(
        "prepare_metric",
        "Register a metric definition that the user wants to track but hasn't recorded values for yet. Surfaces in get_metrics_summary so the agent can offer to log it.",
        {
            metric_name: z.string().describe("Name of the metric."),
            unit: z.string().describe("Unit string."),
            metric_type: z.string().describe("Metric type — 'gauge', 'counter', 'duration', etc."),
            category: z.string().describe("Category bucket."),
        },
        async ({ metric_name, unit, metric_type, category }) =>
            runAndFormat(
                queries.insertPreparedMetric({ metric_name, unit, metric_type, category }),
                handle,
            ),
    );

    // ── Todos ──────────────────────────────────────────────────────────────

    server.tool(
        "insert_todo",
        "Insert a new todo. Status starts as 'active'. due_at defaults to ts (creation time) if no due_date supplied. Stamps the event-time triple. Recurrence is a free-form object (matches the app's recurrence schema — pass null if not recurring).",
        {
            title: z.string().describe("Short title."),
            description: z.string().nullable().optional().describe("Longer description (null if none)."),
            priority: z.string().optional().describe("Priority string (e.g. 'low', 'medium', 'high'). Default 'medium'."),
            category: z.string().optional().describe("Category bucket. Default 'general'."),
            due_date: z.string().nullable().optional().describe("Optional ISO datetime for the due date."),
            recurrence: z.unknown().optional().describe("Optional recurrence object (matches app schema)."),
            metric_link: z.string().nullable().optional().describe("Optional metric_name this todo tracks completion for."),
            source_text: z.string().optional().describe("Original phrasing (default empty)."),
            tags: z.array(z.string()).optional().describe("Optional tag array."),
            event_time_override: z.string().optional().describe("Backfill creation time: YYYY-MM-DD or ISO datetime."),
        },
        async ({ title, description, priority, category, due_date, recurrence, metric_link, source_text, tags, event_time_override }) => {
            try {
                const eventTime = event_time_override
                    ? eventTimeFromOverride(event_time_override)
                    : nowEventTime();
                const spec = queries.insertTodo({
                    title,
                    description: description ?? null,
                    priority: priority ?? "medium",
                    category: category ?? "general",
                    due_date: due_date ?? null,
                    recurrence: recurrence ?? null,
                    metric_link: metric_link ?? null,
                    source_text: source_text ?? "",
                    due_at: due_date ?? eventTime.ts,
                    tags: tags ?? [],
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "record_todo_completion",
        "Record a completion event for a todo (for recurrence tracking). The todo's status is NOT changed — use set_todo_status separately if the todo is one-shot. Stamps event-time at completion moment.",
        {
            parent_id: z.string().describe("Full record id of the parent todo (e.g. 'user_data:abc')."),
            note: z.string().nullable().optional().describe("Optional note about the completion."),
            event_time_override: z.string().optional().describe("Backfill completion time."),
        },
        async ({ parent_id, note, event_time_override }) => {
            try {
                const eventTime = event_time_override
                    ? eventTimeFromOverride(event_time_override)
                    : nowEventTime();
                const spec = queries.insertTodoCompletion({
                    parent_id,
                    note: note ?? null,
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "set_todo_status",
        "Change a todo's top-level status (active / completed / cancelled / deferred).",
        {
            id: z.string().describe("Full record id of the todo."),
            status: z.enum(["active", "completed", "cancelled", "deferred"]).describe("New status."),
        },
        async ({ id, status }) =>
            runAndFormat(queries.setTodoStatus({ recordId: id, status }), handle),
    );

    server.tool(
        "reschedule_todo",
        "Update a todo's due date and/or recurrence rule. At least one must be provided.",
        {
            id: z.string().describe("Full record id of the todo."),
            new_due_date: z.string().optional().describe("New ISO datetime for the due date."),
            new_recurrence: z.unknown().optional().describe("New recurrence object (pass null to clear)."),
        },
        async ({ id, new_due_date, new_recurrence }) => {
            const spec = queries.rescheduleTodo({ recordId: id, new_due_date, new_recurrence });
            if (!spec) {
                return {
                    content: [{ type: "text" as const, text: "reschedule_todo: nothing to update (pass new_due_date or new_recurrence)" }],
                    isError: true,
                };
            }
            return await runAndFormat(spec, handle);
        },
    );

    server.tool(
        "edit_todo",
        "Edit a todo's data fields. Whitelisted keys only: title, description, priority, category, due_date, recurrence, metric_link. Any other key is silently ignored.",
        {
            id: z.string().describe("Full record id of the todo."),
            updates: z.record(z.unknown()).describe("Object with the fields to update."),
        },
        async ({ id, updates }) => {
            const spec = queries.editTodo({ recordId: id, updates });
            if (!spec) {
                return {
                    content: [{ type: "text" as const, text: "edit_todo: no editable fields in updates" }],
                    isError: true,
                };
            }
            return await runAndFormat(spec, handle);
        },
    );

    server.tool(
        "delete_todo",
        "Delete a todo by id. Does NOT auto-cascade completions — call delete_todo_completions first if you want a clean wipe.",
        {
            id: z.string().describe("Full record id of the todo."),
        },
        async ({ id }) =>
            runAndFormat(queries.deleteTodoById(id), handle),
    );

    server.tool(
        "delete_todo_completions",
        "Delete every completion record linked to a todo. Use as cleanup before delete_todo.",
        {
            parent_id: z.string().describe("Full record id of the parent todo."),
        },
        async ({ parent_id }) =>
            runAndFormat(queries.deleteCompletionsForTodo({ parentId: parent_id }), handle),
    );

    // ── Knowledge graph ─────────────────────────────────────────────────────
    //
    // KG writes are one-at-a-time: each tool inserts a single entity or
    // single relation. The underlying `buildKnowledgeInsertQuery` supports
    // multi-statement batches, but exposing those as MCP tools makes the
    // per-call embedding economics opaque (one tool call = one cloud
    // openaiEmbedding charge per entity + per relation). Splitting keeps
    // costs predictable; the agent batches at the conversation level by
    // making multiple tool calls.
    //
    // Relations require BOTH endpoint entities to already exist —
    // insert_kg_relation will fail at the RELATE step if either
    // sourceName or targetName isn't already in user_entities. Insert
    // entities first.

    server.tool(
        "insert_kg_entity",
        "Insert a single knowledge-graph entity by name. Auto-embeds the name for KNN search. Stamps event-time. Re-inserting an existing name creates a duplicate row — caller should check with semantic_search_entities first.",
        {
            name: z.string().describe("Entity name (the node label)."),
        },
        async ({ name }) => {
            try {
                const embedding = await embedQueryText(name, target, cloudConfig, localServerUrl);
                const eventTime = nowEventTime();
                const spec = queries.buildKnowledgeInsertQuery({
                    entities: [{ name, embedding }],
                    relations: [],
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "insert_kg_relation",
        "Insert a single knowledge-graph relation (directed edge) between two existing entities. Both sourceName and targetName must already exist in user_entities — insert them first. Auto-embeds the composite relation name for KNN search.",
        {
            sourceName: z.string().describe("Name of the source entity (must already exist)."),
            targetName: z.string().describe("Name of the target entity (must already exist)."),
            kind: z.string().describe("Relation kind (e.g. 'knows', 'authored', 'lives_in')."),
            name: z.string().optional().describe("Optional custom composite name; defaults to '<sourceName>_<kind>_<targetName>'."),
        },
        async ({ sourceName, targetName, kind, name }) => {
            try {
                const relName = name ?? `${sourceName}_${kind}_${targetName}`;
                const embedding = await embedQueryText(relName, target, cloudConfig, localServerUrl);
                const eventTime = nowEventTime();
                const spec = queries.buildKnowledgeInsertQuery({
                    entities: [],
                    relations: [{ name: relName, sourceName, targetName, kind, embedding }],
                    ...eventTime,
                });
                return await runAndFormat(spec, handle);
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: formatRunError(err) }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "delete_kg_entity",
        "Delete a knowledge-graph entity by name. Does NOT cascade to its relations — call delete_kg_relations_touching first if you want a clean wipe. Returns the deleted row.",
        {
            name: z.string().describe("Entity name."),
        },
        async ({ name }) =>
            runAndFormat(queries.deleteEntityByName(name), handle),
    );

    server.tool(
        "delete_kg_relation",
        "Delete a knowledge-graph relation by its composite name. Returns the deleted row.",
        {
            name: z.string().describe("Composite relation name (sourceName_kind_targetName)."),
        },
        async ({ name }) =>
            runAndFormat(queries.deleteRelationByName(name), handle),
    );

    server.tool(
        "delete_kg_relations_touching",
        "Delete every relation (in either direction) that touches an entity. Use as cleanup before delete_kg_entity.",
        {
            name: z.string().describe("Entity name whose relations should be cleared."),
        },
        async ({ name }) =>
            runAndFormat(queries.deleteRelationsTouchingEntity(name), handle),
    );
}
