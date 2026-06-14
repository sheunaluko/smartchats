/**
 * Query each background-loader fetcher directly against the live seeded DB
 * and report the raw response byte size + a sample of the first row. Reveals:
 *   (a) which fetchers SELECT * (vs explicit-field projections)
 *   (b) row counts (no-limit queries on 1456-metric DB → big response)
 *   (c) any embedding-shaped values leaking into responses (1536 floats per row)
 *
 * Talks directly to SurrealDB HTTP /sql. Fast (~1s), no agent / no browser.
 */
import { Surreal } from 'surrealdb';

const QUERIES: Array<{ id: string; sql: string }> = [
  // 7 background loaders, each with the EXACT query its fetcher runs.
  {
    id: 'metrics_context.summary',
    sql: `SELECT metric_name, unit, category, metric_type, count() AS entry_count, math::max(value) AS max_value, math::min(value) AS min_value FROM metrics GROUP BY metric_name, unit, category, metric_type;`,
  },
  {
    id: 'metrics_context.recent',
    sql: `SELECT * FROM metrics ORDER BY ts DESC;`,            // ← THE SUSPECT — no limit, SELECT *
  },
  {
    id: 'metrics_context.prepared',
    sql: `SELECT * FROM user_data WHERE type = 'metric_definition';`,
  },
  {
    id: 'log_categories',
    sql: `SELECT category, count() AS count FROM logs GROUP BY category ORDER BY count DESC;`,
  },
  {
    id: 'log_categories.prepared',
    sql: `SELECT * FROM user_data WHERE type = 'log_category_definition';`,
  },
  {
    id: 'init_instructions',
    sql: `SELECT id, content, category, created_at FROM cortex WHERE type = 'init_instruction' ORDER BY id ASC;`,
  },
  {
    id: 'procedural_instructions',
    sql: `SELECT id, content, category, created_at, updated_at FROM cortex WHERE type = 'procedural_instruction' ORDER BY id ASC;`,
  },
  {
    id: 'installed_apps',
    sql: `SELECT * FROM smartchats_apps;`,
  },
];

const db = new Surreal();
await db.connect('ws://127.0.0.1:8000/rpc');
await db.signin({ username: 'root', password: 'root' });
await db.use({ namespace: 'smartchats', database: 'main' });

interface Row { id: string; row_count: number; bytes: number; tokens_est: number; has_embedding_field: boolean; sample_row: string }
const rows: Row[] = [];

for (const q of QUERIES) {
  try {
    const r = (await db.query(q.sql)) as unknown[];
    // db.query returns array of statement results; we sent one statement.
    const result = Array.isArray(r) ? r[r.length - 1] : r;
    const arr = Array.isArray(result) ? result : [result];
    const json = JSON.stringify(arr);
    const sample = arr.length > 0 ? JSON.stringify(arr[0]) : '';
    const hasEmbedding = arr.length > 0 && Object.prototype.hasOwnProperty.call(arr[0] as object, 'embedding');
    rows.push({
      id: q.id,
      row_count: arr.length,
      bytes: json.length,
      tokens_est: Math.round(json.length / 4),
      has_embedding_field: hasEmbedding,
      sample_row: sample.length > 240 ? sample.slice(0, 240) + '…' : sample,
    });
  } catch (e) {
    rows.push({ id: q.id, row_count: -1, bytes: -1, tokens_est: -1, has_embedding_field: false, sample_row: `error: ${(e as Error).message}` });
  }
}

await db.close();

rows.sort((a, b) => b.bytes - a.bytes);
console.log();
console.log('background-loader payload audit');
console.log('═'.repeat(96));
console.log(`${'fetcher'.padEnd(34)}  ${'rows'.padStart(6)}  ${'bytes'.padStart(9)}  ${'~tokens'.padStart(8)}  embedding?`);
console.log('─'.repeat(96));
let totalBytes = 0;
for (const r of rows) {
  totalBytes += r.bytes > 0 ? r.bytes : 0;
  console.log(
    `${r.id.padEnd(34)}  ${r.row_count.toString().padStart(6)}  ${r.bytes.toLocaleString().padStart(9)}  ${r.tokens_est.toLocaleString().padStart(8)}  ${r.has_embedding_field ? '⚠ YES' : '·'}`,
  );
}
console.log('─'.repeat(96));
console.log(`${'TOTAL'.padEnd(34)}  ${''.padStart(6)}  ${totalBytes.toLocaleString().padStart(9)}  ${Math.round(totalBytes/4).toLocaleString().padStart(8)}`);
console.log();
console.log('first-row samples (truncated):');
for (const r of rows) {
  if (r.sample_row) {
    console.log(`\n[${r.id}]`);
    console.log(`  ${r.sample_row}`);
  }
}
