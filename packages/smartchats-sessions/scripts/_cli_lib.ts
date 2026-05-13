/**
 * Small shared helpers for the session analysis CLI scripts.
 *
 * Each script is a thin shell around one analyzer + formatter pair:
 *   1. parse argv (positional path + flags)
 *   2. read the bundle JSON
 *   3. run analyze*(bundle, opts)
 *   4. print format*(result, opts)
 *
 * Stays Node-only on purpose — never imported by the analysis modules
 * themselves (those stay pure).
 */

import { readFileSync } from 'node:fs';
import type { SessionBundle } from '../src/types.js';

export interface ParsedArgs {
    positional: string[];
    flags: Set<string>;
    values: Record<string, string>;
}

export function parseArgs(argv: string[], valued: Set<string> = new Set()): ParsedArgs {
    const positional: string[] = [];
    const flags = new Set<string>();
    const values: Record<string, string> = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--') && a.includes('=')) {
            const [k, v] = a.split('=', 2);
            values[k] = v;
        } else if (valued.has(a)) {
            values[a] = argv[++i];
        } else if (a.startsWith('-')) {
            flags.add(a);
        } else {
            positional.push(a);
        }
    }
    return { positional, flags, values };
}

export function loadBundle(path: string): SessionBundle {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SessionBundle;
}

export function die(msg: string, code: number = 1): never {
    process.stderr.write(msg.endsWith('\n') ? msg : `${msg}\n`);
    process.exit(code);
}

export function requirePath(args: ParsedArgs, usage: string): string {
    if (args.flags.has('-h') || args.flags.has('--help')) die(usage, 0);
    if (args.positional.length === 0) die(usage);
    return args.positional[0];
}
