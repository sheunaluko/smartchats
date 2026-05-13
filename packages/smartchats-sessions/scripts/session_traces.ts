#!/usr/bin/env -S npx tsx
/**
 * CLI: trace causality trees from a session bundle.
 *
 * Usage:
 *   npm run analyze:traces -- <bundle.json> [--markdown] [--trace=<id>] [--min-events=N]
 */

import { buildTraceTrees, formatTraces } from '../src/analysis/traces.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_traces <bundle.json> [--markdown] [--trace=<id>] [--min-events=N]`;

const args = parseArgs(process.argv, new Set(['--trace', '--min-events']));
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const result = buildTraceTrees(bundle);
const minEventsRaw = args.values['--min-events'];
process.stdout.write(
    formatTraces(result, {
        markdown: args.flags.has('--markdown') || args.flags.has('--md'),
        traceId: args.values['--trace'],
        minEvents: minEventsRaw ? parseInt(minEventsRaw, 10) : undefined,
    }),
);
