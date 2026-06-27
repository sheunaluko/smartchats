import type { WebSocket } from 'ws';
import { registry } from '../state.js';
import { verifyToken } from '../auth.js';
import { log } from '../lib/log.js';
import { config } from '../config.js';

const FORWARDED_FROM_CLIENT = new Set(['input', 'resize', 'request_snapshot']);

export function attachClientHandler(ws: WebSocket): void {
    let userId: string | null = null;
    let helloTimer: NodeJS.Timeout | null = setTimeout(() => {
        try { ws.close(1008, 'hello timeout'); } catch {}
    }, config.helloTimeoutMs);

    ws.on('message', async (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'client_hello') {
            if (userId) return;
            if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
            try {
                const identity = await verifyToken(String(msg.token ?? ''));
                if (registry.clientsForUser(identity.uid).length >= config.maxClientsPerUser) {
                    ws.send(JSON.stringify({ type: 'error', code: 'QUOTA_CLIENTS' }));
                    try { ws.close(1008, 'quota'); } catch {}
                    return;
                }
                userId = identity.uid;
                registry.registerClient(ws, identity.uid, identity.exp);
                ws.send(JSON.stringify({
                    type: 'session_list',
                    sessions: registry.listSessionsForUser(userId),
                }));
                log.info({ userId }, 'client registered');
            } catch (e) {
                log.warn({ err: (e as Error).message }, 'client auth failed');
                try { ws.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED' })); } catch {}
                try { ws.close(1008, 'auth'); } catch {}
            }
            return;
        }

        if (!userId) return;
        const client = registry.getClient(ws);
        if (!client) return;

        if (msg.type === 'client_reauth') {
            try {
                const identity = await verifyToken(String(msg.token ?? ''));
                if (identity.uid !== client.userId) {
                    try { ws.close(1008, 'identity changed'); } catch {}
                    return;
                }
                client.tokenExp = identity.exp;
            } catch {
                try { ws.close(1008, 'reauth failed'); } catch {}
            }
            return;
        }

        if (msg.type === 'subscribe') {
            const sid = String(msg.session_id ?? '');
            const result = registry.subscribeClient(ws, sid);
            if (!result.ok) {
                ws.send(JSON.stringify({ type: 'error', code: result.reason ?? 'FORBIDDEN' }));
                return;
            }
            const bridge = registry.getBridge(sid);
            if (bridge && bridge.socket.readyState === bridge.socket.OPEN) {
                bridge.socket.send(JSON.stringify({ type: 'request_snapshot' }));
            }
            return;
        }

        if (FORWARDED_FROM_CLIENT.has(msg.type)) {
            if (!client.subscribedTo) return;
            const bridge = registry.getBridge(client.subscribedTo);
            if (!bridge || bridge.socket.readyState !== bridge.socket.OPEN) return;
            bridge.socket.send(JSON.stringify(msg));
        }
    });

    ws.on('close', () => {
        if (helloTimer) clearTimeout(helloTimer);
        registry.unregisterClient(ws);
    });
}
