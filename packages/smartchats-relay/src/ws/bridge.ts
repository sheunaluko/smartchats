import type { WebSocket } from 'ws';
import { registry, type BridgeKind } from '../state.js';
import { verifyToken } from '../auth.js';
import { log } from '../lib/log.js';
import { config } from '../config.js';

// Which bridge → client message types are forwarded, keyed by bridge kind.
// PTY-wrapped CLI agents stream terminal I/O + idle events. MCP agent
// participants stream discrete agent_event messages (see smartchats-mcp-bridge).
const FORWARDED_FROM_BRIDGE: Record<BridgeKind, ReadonlySet<string>> = {
    pty:   new Set(['output', 'snapshot', 'lines', 'idle', 'active', 'exit']),
    agent: new Set(['agent_event']),
};

function parseBridgeKind(raw: unknown): BridgeKind {
    return raw === 'agent' ? 'agent' : 'pty';
}

export function attachBridgeHandler(ws: WebSocket): void {
    let sessionId: string | null = null;
    let helloTimer: NodeJS.Timeout | null = setTimeout(() => {
        try { ws.close(1008, 'hello timeout'); } catch {}
    }, config.helloTimeoutMs);

    ws.on('message', async (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'bridge_hello') {
            if (sessionId) return;
            if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
            try {
                const identity = await verifyToken(String(msg.token ?? ''));
                if (registry.bridgesForUser(identity.uid).length >= config.maxBridgesPerUser) {
                    ws.send(JSON.stringify({ type: 'error', code: 'QUOTA_BRIDGES' }));
                    try { ws.close(1008, 'quota'); } catch {}
                    return;
                }
                sessionId = String(msg.bridge_id ?? '');
                if (!sessionId) {
                    ws.send(JSON.stringify({ type: 'error', code: 'BAD_BRIDGE_ID' }));
                    try { ws.close(1008, 'bad_bridge_id'); } catch {}
                    return;
                }
                const kind = parseBridgeKind(msg.kind);
                registry.registerBridge({
                    socket: ws,
                    sessionId,
                    userId: identity.uid,
                    kind,
                    label: String(msg.label ?? 'unnamed'),
                    model: String(msg.model ?? 'claude'),
                    tokenExp: identity.exp,
                    lastActiveMs: Date.now(),
                });
                ws.send(JSON.stringify({ type: 'bridge_registered', session_id: sessionId }));
                log.info({ userId: identity.uid, sessionId, kind }, 'bridge registered');
            } catch (e) {
                log.warn({ err: (e as Error).message }, 'bridge auth failed');
                try { ws.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED' })); } catch {}
                try { ws.close(1008, 'auth'); } catch {}
            }
            return;
        }

        if (!sessionId) return;
        const entry = registry.getBridge(sessionId);
        if (!entry || entry.socket !== ws) return;
        entry.lastActiveMs = Date.now();

        if (msg.type === 'bridge_reauth') {
            try {
                const identity = await verifyToken(String(msg.token ?? ''));
                if (identity.uid !== entry.userId) {
                    try { ws.close(1008, 'identity changed'); } catch {}
                    return;
                }
                entry.tokenExp = identity.exp;
            } catch {
                try { ws.close(1008, 'reauth failed'); } catch {}
            }
            return;
        }

        if (FORWARDED_FROM_BRIDGE[entry.kind].has(msg.type)) {
            const payload = JSON.stringify(msg);
            for (const sub of registry.subscribers_of(sessionId)) {
                if (sub.readyState === sub.OPEN) sub.send(payload);
            }
        }
    });

    ws.on('close', () => {
        if (helloTimer) clearTimeout(helloTimer);
        if (sessionId) {
            registry.unregisterBridge(sessionId);
            log.info({ sessionId }, 'bridge disconnected');
        }
    });
}
