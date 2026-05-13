#!/usr/bin/env -S npx tsx
/**
 * CLI: pretty-print a single event (with parent/children/trace siblings) or
 *      a whole trace, from a session bundle.
 *
 * Usage:
 *   npm run analyze:inspect -- <bundle.json> --event=<event_id> [--markdown] [--no-payload]
 *   npm run analyze:inspect -- <bundle.json> --trace=<trace_id> [--markdown]
 */

import {
    inspectEvent,
    inspectTrace,
    formatInspectEvent,
    formatInspectTrace,
} from '../src/analysis/inspect.js';
import { loadBundle, parseArgs, requirePath, die } from './_cli_lib.js';

const USAGE = `Usage: session_inspect <bundle.json> --event=<id> | --trace=<id> [--markdown] [--no-payload]`;

const args = parseArgs(process.argv, new Set(['--event', '--trace']));
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const eventId = args.values['--event'];
const traceId = args.values['--trace'];
const markdown = args.flags.has('--markdown') || args.flags.has('--md');

if (eventId) {
    const r = inspectEvent(bundle, eventId);
    if (!r) die(`Event not found: ${eventId}`);
    process.stdout.write(formatInspectEvent(r, { markdown, rawPayload: !args.flags.has('--no-payload') }));
    process.stdout.write('\n');
} else if (traceId) {
    const events = inspectTrace(bundle, traceId);
    if (events.length === 0) die(`Trace not found or empty: ${traceId}`);
    process.stdout.write(formatInspectTrace(events, traceId, { markdown }));
    process.stdout.write('\n');
} else {
    die(USAGE);
}
