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

    test('agent-kind bridge_hello registers with kind: agent', async () => {
        const ws = connect('/bridge');
        await waitOpen(ws);
        ws.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-agentUser',
            bridge_id: 'sid-agent-1',
            kind: 'agent',
            label: 'claude-code @ mac',
            model: 'claude',
        }));
        const msg = await nextMessage(ws);
        expect(msg.type).toBe('bridge_registered');
        expect(msg.session_id).toBe('sid-agent-1');

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-agentUser' }));
        const list = await nextMessage(client);
        expect(list.type).toBe('session_list');
        const session = list.sessions.find((s: any) => s.session_id === 'sid-agent-1');
        expect(session).toBeDefined();
        expect(session.kind).toBe('agent');
        ws.close(); client.close();
    });

    test('agent-kind subscribe does NOT trigger request_snapshot', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-agentUser2',
            bridge_id: 'sid-agent-2',
            kind: 'agent',
            label: 'agent',
        }));
        await nextMessage(bridge); // bridge_registered

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-agentUser2' }));
        await nextMessage(client); // session_list

        client.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-agent-2' }));
        const sub = await nextMessage(client);
        expect(sub).toEqual({ type: 'subscribed', session_id: 'sid-agent-2' });

        // Round-trip an agent_event to prove nothing came before it — no snapshot request.
        bridge.send(JSON.stringify({
            type: 'agent_event', event: 'message',
            text: 'hello', timestamp: 1,
        }));
        const evt = await nextMessage(client);
        expect(evt.type).toBe('agent_event');
        expect(evt.text).toBe('hello');

        bridge.close(); client.close();
    });

    test('agent_event bridge → client and agent_message client → bridge', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-agentUser3',
            bridge_id: 'sid-agent-3',
            kind: 'agent',
            label: 'agent',
        }));
        await nextMessage(bridge);

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-agentUser3' }));
        await nextMessage(client);
        client.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-agent-3' }));
        await nextMessage(client); // subscribed

        client.send(JSON.stringify({
            type: 'agent_message', text: 'hi', timestamp: 42,
        }));
        const inbound = await nextMessage(bridge);
        expect(inbound).toEqual({ type: 'agent_message', text: 'hi', timestamp: 42 });

        bridge.close(); client.close();
    });

    test('agent-kind bridges reject pty-only message types', async () => {
        const bridge = connect('/bridge');
        await waitOpen(bridge);
        bridge.send(JSON.stringify({
            type: 'bridge_hello',
            token: 'tok-agentUser4',
            bridge_id: 'sid-agent-4',
            kind: 'agent',
            label: 'agent',
        }));
        await nextMessage(bridge);

        const client = connect('/client');
        await waitOpen(client);
        client.send(JSON.stringify({ type: 'client_hello', token: 'tok-agentUser4' }));
        await nextMessage(client);
        client.send(JSON.stringify({ type: 'subscribe', session_id: 'sid-agent-4' }));
        await nextMessage(client);

        // 'input' is PTY-only. Should NOT be forwarded to an agent bridge.
        // We follow it with a valid agent_message and expect only that one to arrive.
        client.send(JSON.stringify({ type: 'input', data: 'ls\n' }));
        client.send(JSON.stringify({ type: 'agent_message', text: 'marker', timestamp: 99 }));
        const received = await nextMessage(bridge);
        expect(received.type).toBe('agent_message');
        expect(received.text).toBe('marker');

        // 'output' from an agent bridge is likewise not forwarded (only agent_event is).
        bridge.send(JSON.stringify({ type: 'output', data: 'garbage' }));
        bridge.send(JSON.stringify({
            type: 'agent_event', event: 'message', text: 'clean', timestamp: 100,
        }));
        const evt = await nextMessage(client);
        expect(evt.type).toBe('agent_event');
        expect(evt.text).toBe('clean');

        bridge.close(); client.close();
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
