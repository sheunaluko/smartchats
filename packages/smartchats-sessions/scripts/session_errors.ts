#!/usr/bin/env -S npx tsx
/**
 * CLI: extract errors with context from a session bundle.
 *
 * Usage:
 *   npm run analyze:errors -- <bundle.json> [--markdown]
 */

import { analyzeErrors, formatErrors } from '../src/analysis/errors.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_errors <bundle.json> [--markdown]`;

const args = parseArgs(process.argv);
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const result = analyzeErrors(bundle);
process.stdout.write(formatErrors(result, { markdown: args.flags.has('--markdown') || args.flags.has('--md') }));
