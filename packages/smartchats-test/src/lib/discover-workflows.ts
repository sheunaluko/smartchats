/**
 * Discover Simi workflows from `apps/smartchats/tests/e2e/simi.spec.ts`.
 *
 * Parses the WORKFLOWS array via regex — simpler + more robust than
 * dynamic-importing the TSX file (which would drag in React/Zustand/etc.
 * from a Node CLI context).
 *
 * The spec's WORKFLOWS list has shape:
 *   { name: 'foo_flow', bridge: '__smartchats__' [, requiresBilling: true] }
 *
 * We capture the name, the bridge, and the requiresBilling flag.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DiscoveredWorkflow {
    name: string;
    bridge: string;
    requiresBilling: boolean;
}

const WORKFLOW_ENTRY_RE =
    /\{\s*name:\s*['"]([a-z0-9_]+)['"]\s*,\s*bridge:\s*['"]([a-z_]+)['"](?:\s*,\s*requiresBilling:\s*(true|false))?\s*\}/g;

export function discoverWorkflows(repoRoot: string): DiscoveredWorkflow[] {
    const specPath = path.join(repoRoot, 'apps', 'smartchats', 'tests', 'e2e', 'simi.spec.ts');
    if (!fs.existsSync(specPath)) {
        return [];
    }
    const src = fs.readFileSync(specPath, 'utf8');

    // Try to scope to just the WORKFLOWS array first to avoid false positives
    // from comments or other arrays.
    const arrStart = src.indexOf('const ALL_WORKFLOWS');
    const arrBody = arrStart === -1 ? src : src.slice(arrStart);

    const found: DiscoveredWorkflow[] = [];
    let m: RegExpExecArray | null;
    while ((m = WORKFLOW_ENTRY_RE.exec(arrBody)) !== null) {
        found.push({
            name: m[1],
            bridge: m[2],
            requiresBilling: m[3] === 'true',
        });
    }
    return found;
}
