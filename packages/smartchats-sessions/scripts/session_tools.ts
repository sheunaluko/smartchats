#!/usr/bin/env -S npx tsx
/**
 * CLI: code-execution + tool-call analysis from a session bundle.
 *
 * Usage:
 *   npm run analyze:tools -- <bundle.json> [--markdown] [--code-max=N]
 */

import { analyzeExecutions, formatExecutions } from '../src/analysis/executions.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_tools <bundle.json> [--markdown] [--code-max=N]`;

const args = parseArgs(process.argv, new Set(['--code-max']));
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const result = analyzeExecutions(bundle);
const codeMaxRaw = args.values['--code-max'];
process.stdout.write(
    formatExecutions(result, {
        markdown: args.flags.has('--markdown') || args.flags.has('--md'),
        codeMaxChars: codeMaxRaw ? parseInt(codeMaxRaw, 10) : undefined,
    }),
);
