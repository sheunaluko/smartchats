import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';

process.env.DEV_TOKEN_BYPASS = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const { createRelay } = await import('../src/server.js');

let handle: ReturnType<typeof createRelay>;
let baseUrl: string;

beforeAll(async () => {
    handle = createRelay();
    await new Promise<void>((resolve) => handle.server.listen(0, resolve));
    const port = (handle.server.address() as AddressInfo).port;
    baseUrl = `ws://localhost:${port}`;
});

afterAll(async () => {
    await handle.stop();
});

function connect(path: string): WebSocket {
    return new WebSocket(`${baseUrl}${path}`);
}

function nextMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve, reject) => {
        const onMsg = (raw: WebSocket.RawData) => {
            ws.off('message', onMsg);
            ws.off('error', onErr);
            resolve(JSON.parse(raw.toString()));
        };
        const onErr = (err: Error) => {
            ws.off('message', onMsg);
            reject(err);
        };
        ws.on('message', onMsg);
        ws.on('error', onErr);
    });
}

function waitOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
}

describe('relay routing', () => {
    test('bridge_hello → bridge_registered', async () => {
        const ws = connect('/bridge');
        await waitOpen(ws);
        ws.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-userA',
            bridge_id: 'sid-1',
            label: 'mac',
            model: 'claude',
        }));
        const msg = await nextMessage(ws);
        expect(msg.type).toBe('bridge_registered');
        expect(msg.session_id).toBe('sid-1');
        ws.close();
    });

    test('client_hello returns session_list with active bridge', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-userB',
            bridge_id: 'sid-2',
            label: 'desktop',
        }));
        await nextMessage(bridge); // bridge_registered

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-userB' }));
        const list = await nextMessage(client);
        expect(list.type).toBe('session_list');
        expect(list.sessions.length).toBeGreaterThanOrEqual(1);
        expect(list.sessions.some((s: any) => s.session_id === 'sid-2')).toBe(true);
        bridge.close(); client.close();
    });

    test('subscribe forwards output bridge → client; input client → bridge', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-userC',
            bridge_id: 'sid-3',
            label: 'laptop',
        }));
        await nextMessage(bridge);

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-userC' }));
        await nextMessage(client); // session_list

        client.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-3' }));
        const sub = await nextMessage(client);
        expect(sub).toEqual({ type: 'subscribed', session_id: 'sid-3' });
        const reqSnap = await nextMessage(bridge);
        expect(reqSnap.type).toBe('request_snapshot');

        bridge.send(JSON.stringify({ type: 'output', data: 'hello\r\n' }));
        const out = await nextMessage(client);
        expect(out).toEqual({ type: 'output', data: 'hello\r\n' });

        client.send(JSON.stringify({ type: 'input', data: 'ls\n' }));
        const inp = await nextMessage(bridge);
        expect(inp).toEqual({ type: 'input', data: 'ls\n' });

        bridge.close(); client.close();
    });

    test('cross-user subscribe is rejected', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-victim',
            bridge_id: 'sid-victim',
            label: 'mac',
        }));
        await nextMessage(bridge);

        const attacker = connect('/client');
        await waitOpen(attacker);
        attacker.send(JSON.stringify({ type: 'client_hello', token: 'tok-attacker' }));
        await nextMessage(attacker); // session_list (empty for this user)

        attacker.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-victim' }));
        const err = await nextMessage(attacker);
        expect(err.type).toBe('error');
        expect(['FORBIDDEN', 'NOT_FOUND']).toContain(err.code);

        bridge.close(); attacker.close();
    });

    test('bridge disconnect notifies subscribers with session_offline', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-userD',
            bridge_id: 'sid-4',
            label: 'mac',
        }));
        await nextMessage(bridge);

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-userD' }));
        await nextMessage(client);
        client.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-4' }));
        await nextMessage(client); // subscribed ack
        await nextMessage(bridge); // request_snapshot

        bridge.close();
        const offline = await nextMessage(client);
        expect(offline).toEqual({ type: 'session_offline', session_id: 'sid-4' });
        client.close();
    });
});
