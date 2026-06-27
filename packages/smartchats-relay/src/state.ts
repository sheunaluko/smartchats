import type { WebSocket } from 'ws';

export interface BridgeEntry {
    socket: WebSocket;
    sessionId: string;
    userId: string;
    label: string;
    model: string;
    tokenExp: number;
    lastActiveMs: number;
}

export interface ClientEntry {
    socket: WebSocket;
    userId: string;
    tokenExp: number;
    subscribedTo: string | null;
}

export interface SessionMeta {
    session_id: string;
    label: string;
    model: string;
    online: boolean;
    last_active_ms_ago: number;
}

export class Registry {
    private bridges = new Map<string, BridgeEntry>();
    private clients = new Map<WebSocket, ClientEntry>();
    private subscribers = new Map<string, Set<WebSocket>>();

    registerBridge(entry: BridgeEntry): void {
        const existing = this.bridges.get(entry.sessionId);
        if (existing && existing.socket !== entry.socket) {
            try { existing.socket.close(1000, 'replaced'); } catch {}
        }
        this.bridges.set(entry.sessionId, entry);
        if (!this.subscribers.has(entry.sessionId)) {
            this.subscribers.set(entry.sessionId, new Set());
        }
    }

    unregisterBridge(sessionId: string): void {
        const subs = this.subscribers.get(sessionId);
        if (subs) {
            const msg = JSON.stringify({ type: 'session_offline', session_id: sessionId });
            for (const sub of subs) {
                if (sub.readyState === sub.OPEN) sub.send(msg);
            }
        }
        this.bridges.delete(sessionId);
        this.subscribers.delete(sessionId);
    }

    getBridge(sessionId: string): BridgeEntry | undefined {
        return this.bridges.get(sessionId);
    }

    bridgesForUser(userId: string): BridgeEntry[] {
        const out: BridgeEntry[] = [];
        for (const b of this.bridges.values()) if (b.userId === userId) out.push(b);
        return out;
    }

    registerClient(socket: WebSocket, userId: string, tokenExp: number): void {
        this.clients.set(socket, { socket, userId, tokenExp, subscribedTo: null });
    }

    unregisterClient(socket: WebSocket): void {
        const c = this.clients.get(socket);
        if (c && c.subscribedTo) {
            this.subscribers.get(c.subscribedTo)?.delete(socket);
        }
        this.clients.delete(socket);
    }

    getClient(socket: WebSocket): ClientEntry | undefined {
        return this.clients.get(socket);
    }

    clientsForUser(userId: string): ClientEntry[] {
        const out: ClientEntry[] = [];
        for (const c of this.clients.values()) if (c.userId === userId) out.push(c);
        return out;
    }

    subscribeClient(socket: WebSocket, sessionId: string): { ok: boolean; reason?: string } {
        const c = this.clients.get(socket);
        const b = this.bridges.get(sessionId);
        if (!c) return { ok: false, reason: 'NO_CLIENT' };
        if (!b) return { ok: false, reason: 'NOT_FOUND' };
        if (b.userId !== c.userId) return { ok: false, reason: 'FORBIDDEN' };
        if (c.subscribedTo && c.subscribedTo !== sessionId) {
            this.subscribers.get(c.subscribedTo)?.delete(socket);
        }
        c.subscribedTo = sessionId;
        let subs = this.subscribers.get(sessionId);
        if (!subs) { subs = new Set(); this.subscribers.set(sessionId, subs); }
        subs.add(socket);
        return { ok: true };
    }

    subscribers_of(sessionId: string): Set<WebSocket> {
        return this.subscribers.get(sessionId) ?? new Set();
    }

    listSessionsForUser(userId: string): SessionMeta[] {
        const now = Date.now();
        return this.bridgesForUser(userId).map((b) => ({
            session_id: b.sessionId,
            label: b.label,
            model: b.model,
            online: true,
            last_active_ms_ago: now - b.lastActiveMs,
        }));
    }

    counts(): { bridges: number; clients: number } {
        return { bridges: this.bridges.size, clients: this.clients.size };
    }

    sweepExpired(nowSeconds: number): void {
        for (const [sid, b] of this.bridges) {
            if (b.tokenExp < nowSeconds) {
                try { b.socket.close(1008, 'token expired'); } catch {}
                this.unregisterBridge(sid);
            }
        }
        for (const c of Array.from(this.clients.values())) {
            if (c.tokenExp < nowSeconds) {
                try { c.socket.close(1008, 'token expired'); } catch {}
                this.unregisterClient(c.socket);
            }
        }
    }
}

export const registry = new Registry();
