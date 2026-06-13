/**
 * Run every scenario's `surql_probe` against a live, seeded SurrealDB,
 * compare against the TS-computed `ts_truth`, and fail on the first
 * divergence.
 *
 * Assumes the stack is already running and seeded — usually started via:
 *
 *   bin/test-bun-deploy --seed packages/benchpress/fixtures/canonical_user.surql
 *
 * Exit codes:
 *   0  all probes match their truths
 *   1  one or more probes diverged (details printed)
 *   2  setup error (connection, missing fixtures, etc.)
 *
 *   tsx packages/benchpress/scripts/verify_seed.ts [--endpoint ws://...]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';

import type { TruthsSnapshot } from '../src/types.js';

interface Args {
  endpoint: string;
  ns: string;
  db: string;
  user: string;
  pass: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    endpoint: 'ws://127.0.0.1:8000/rpc',
    ns: 'smartchats',
    db: 'main',
    user: 'root',
    pass: 'root',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === '--endpoint') out.endpoint = next();
    else if (a === '--ns') out.ns = next();
    else if (a === '--db') out.db = next();
    else if (a === '--user') out.user = next();
    else if (a === '--pass') out.pass = next();
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: verify_seed [--endpoint ws://...] [--ns ...] [--db ...] [--user ...] [--pass ...]`);
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const truthsPath = resolve(pkgRoot, 'fixtures', 'truths.json');

let truths: TruthsSnapshot;
try {
  truths = JSON.parse(readFileSync(truthsPath, 'utf8'));
} catch (e) {
  console.error(`error reading ${truthsPath}: ${(e as Error).message}`);
  console.error(`run \`npm run generate\` first.`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const db = new Surreal();
try {
  await db.connect(args.endpoint);
  await db.signin({ username: args.user, password: args.pass });
  await db.use({ namespace: args.ns, database: args.db });
} catch (e) {
  console.error(`connect/auth failed: ${(e as Error).message}`);
  console.error(`is bin/test-bun-deploy --seed ... running?`);
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────────────────
// Run probes
// ──────────────────────────────────────────────────────────────────────────

interface ProbeResult { id: string; kind: string; status: 'ok' | 'skipped' | 'diverged' | 'error'; detail?: string }

const results: ProbeResult[] = [];

for (const [id, entry] of Object.entries(truths.scenarios)) {
  if (!entry.surql_probe) {
    results.push({ id, kind: entry.kind, status: 'skipped', detail: 'no surql_probe' });
    continue;
  }
  let raw: unknown;
  try {
    const queryResult = await db.query(entry.surql_probe);
    raw = lastStatementResult(queryResult);
  } catch (e) {
    results.push({ id, kind: entry.kind, status: 'error', detail: `query failed: ${(e as Error).message}` });
    continue;
  }
  const cmp = compare(entry.kind, entry.truth, raw);
  if (cmp.ok) {
    results.push({ id, kind: entry.kind, status: 'ok' });
  } else {
    results.push({ id, kind: entry.kind, status: 'diverged', detail: cmp.reason });
  }
}

await db.close();

// ──────────────────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────────────────

const ok = results.filter((r) => r.status === 'ok').length;
const skipped = results.filter((r) => r.status === 'skipped').length;
const diverged = results.filter((r) => r.status === 'diverged');
const errored = results.filter((r) => r.status === 'error');

console.log();
console.log(`benchpress: verified ${results.length} scenarios`);
console.log(`  ok:       ${ok}`);
console.log(`  skipped:  ${skipped} (no probe — kind handled in Part 2 trace assertions)`);
console.log(`  diverged: ${diverged.length}`);
console.log(`  errored:  ${errored.length}`);
console.log();

if (diverged.length || errored.length) {
  for (const r of [...diverged, ...errored]) {
    console.log(`  ✗ ${r.id} (${r.kind}, ${r.status}): ${r.detail}`);
  }
  process.exit(1);
}

for (const r of results) {
  const mark = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '·' : '✗';
  console.log(`  ${mark} ${r.id} (${r.kind})`);
}
process.exit(0);

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * SurrealDB's .query() returns an array of statement results. For our probes:
 *   - single SELECT → array of rows is the only entry
 *   - multi-statement LET; LET; RETURN → last entry is the RETURN value
 * We always want the last statement's value.
 */
function lastStatementResult(queryResult: unknown): unknown {
  if (!Array.isArray(queryResult) || queryResult.length === 0) return queryResult;
  return queryResult[queryResult.length - 1];
}

interface CmpResult { ok: boolean; reason?: string }

function compare(kind: string, truth: unknown, raw: unknown): CmpResult {
  const normProbe = normalizeProbe(kind, raw);
  const normTruth = normalizeTruth(kind, truth);
  if (deepEqual(normProbe, normTruth)) return { ok: true };
  return {
    ok: false,
    reason: `probe=${JSON.stringify(normProbe)} truth=${JSON.stringify(normTruth)}`,
  };
}

/** Surreal returns flat arrays from `SELECT VALUE`; unwrap scalars + missing rows. */
function normalizeProbe(kind: string, raw: unknown): unknown {
  let v: unknown = raw;
  // Unwrap single-element arrays for scalars / dates / negatives.
  if (kind === 'scalar' || kind === 'date' || kind === 'negative') {
    while (Array.isArray(v) && v.length === 1) v = v[0];
    if (Array.isArray(v) && v.length === 0) v = null;
  }
  if (kind === 'list' && Array.isArray(v)) {
    const sorted = [...v].sort((a, b) =>
      typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : 0,
    );
    return sorted;
  }
  if (kind === 'comparison' && v && typeof v === 'object') {
    return roundNumbers(v);
  }
  if (kind === 'scalar' && typeof v === 'number') return round3(v);
  return v;
}

function normalizeTruth(kind: string, truth: unknown): unknown {
  if (kind === 'list' && Array.isArray(truth)) {
    return [...truth].sort((a, b) =>
      typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : 0,
    );
  }
  if (kind === 'comparison' && truth && typeof truth === 'object') {
    return roundNumbers(truth);
  }
  if (kind === 'scalar' && typeof truth === 'number') return round3(truth);
  return truth;
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1000) / 1000;
}

function roundNumbers(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(roundNumbers);
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = typeof v === 'number' ? round3(v) : roundNumbers(v);
    }
    return out;
  }
  return typeof o === 'number' ? round3(o) : o;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
