import type { IncomingMessage, ServerResponse } from 'node:http';
import { registry } from '../state.js';

const startedAtMs = Date.now();

export function healthzHandler(_req: IncomingMessage, res: ServerResponse): void {
    const counts = registry.counts();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        ok: true,
        bridges: counts.bridges,
        clients: counts.clients,
        uptime_s: Math.round((Date.now() - startedAtMs) / 1000),
    }));
}
