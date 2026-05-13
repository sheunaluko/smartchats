#!/usr/bin/env -S npx tsx
/**
 * CLI: timing + latency breakdown of a session bundle.
 *
 * Usage:
 *   npm run analyze:performance -- <bundle.json> [--markdown]
 */

import { analyzePerformance, formatPerformance } from '../src/analysis/performance.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_performance <bundle.json> [--markdown]`;

const args = parseArgs(process.argv);
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const result = analyzePerformance(bundle);
process.stdout.write(formatPerformance(result, { markdown: args.flags.has('--markdown') || args.flags.has('--md') }));
