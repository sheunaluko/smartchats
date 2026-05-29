/**
 * Shared provider-key + .env handling.
 *
 * `launch` (docker path) and `setup` (native-binary path) both walk the same
 * provider list and write to the same `.env` file at the repo root. This
 * module owns the canonical PROVIDERS list, the dotenv read/write/merge
 * implementation, and the helpers each command uses to surface "we already
 * have a key for this provider in $env / .env".
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProviderSpec {
    label: string;
    /** Canonical .env key name. */
    canonical: string;
    /** All env var names we'll accept (process.env + .env). First match wins. */
    envNames: string[];
    /** Stack won't work in any meaningful way without this. */
    required: boolean;
    /** Human-readable note shown when the user skips. */
    skipNote: string;
}

export const PROVIDERS: ProviderSpec[] = [
    {
        label: 'OpenAI',
        canonical: 'OPENAI_API_KEY',
        envNames: ['SMARTCHATS_OPENAI_API_KEY', 'OPENAI_API_KEY'],
        required: true,
        skipNote: 'chat + embeddings + TTS will all be unavailable',
    },
    {
        label: 'Anthropic (Claude)',
        canonical: 'ANTHROPIC_API_KEY',
        envNames: ['SMARTCHATS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
        required: false,
        skipNote: "Claude models won't be selectable",
    },
    {
        label: 'Google (Gemini)',
        canonical: 'GOOGLE_API_KEY',
        envNames: ['SMARTCHATS_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        required: false,
        skipNote: "Gemini models won't be selectable",
    },
    {
        label: 'Serper (web search)',
        canonical: 'SERPER_API_KEY',
        envNames: ['SMARTCHATS_SERPER_API_KEY', 'SERPER_API_KEY'],
        required: false,
        skipNote: "the agent's web-search tool will be a no-op",
    },
];

export function maskKey(value: string): string {
    if (value.length <= 8) return '*'.repeat(value.length);
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function findExistingValue(
    spec: ProviderSpec,
    dotenv: Record<string, string>,
): { value: string; source: string } | null {
    for (const name of spec.envNames) {
        if (process.env[name]) return { value: process.env[name]!, source: `env $${name}` };
    }
    for (const name of spec.envNames) {
        if (dotenv[name]) return { value: dotenv[name], source: `.env $${name}` };
    }
    return null;
}

export function parseDotenv(file: string): Record<string, string> {
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        // Strip surrounding quotes (consistent with bash `KEY="value"` style).
        if ((val.startsWith('"') && val.endsWith('"'))
            || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

/**
 * Merge-write `values` into `file`. Preserves comments + existing key order;
 * updates in place for keys present in `values`; appends others at the end.
 */
export function writeDotenv(file: string, values: Record<string, string>): void {
    const lines: string[] = [];
    const written = new Set<string>();
    if (fs.existsSync(file)) {
        for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) {
                lines.push(raw);
                continue;
            }
            const eq = line.indexOf('=');
            if (eq < 0) { lines.push(raw); continue; }
            const key = line.slice(0, eq).trim();
            if (key in values) {
                lines.push(`${key}=${values[key]}`);
                written.add(key);
            } else {
                lines.push(raw);
            }
        }
    }
    for (const [key, value] of Object.entries(values)) {
        if (!written.has(key)) lines.push(`${key}=${value}`);
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
}

export function dotenvPath(repoRoot: string): string {
    return path.join(repoRoot, '.env');
}
