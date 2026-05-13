#!/usr/bin/env -S npx tsx
/**
 * CLI: extract a conversation transcript from a session bundle.
 *
 * Usage:
 *   npm run analyze:transcript -- <bundle.json> [--markdown] [--with-code]
 *                                                 [--timestamps] [--no-thoughts]
 */

import { analyzeTranscript, formatTranscript } from '../src/analysis/transcript.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_transcript <bundle.json> [--markdown] [--with-code] [--timestamps] [--no-thoughts]`;

const args = parseArgs(process.argv);
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const result = analyzeTranscript(bundle, { withCode: args.flags.has('--with-code') });
process.stdout.write(
    formatTranscript(result, {
        markdown: args.flags.has('--markdown') || args.flags.has('--md'),
        timestamps: args.flags.has('--timestamps'),
        hideThoughts: args.flags.has('--no-thoughts'),
    }),
);
