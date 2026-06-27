import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { log } from './lib/log.js';
import { attachBridgeHandler } from './ws/bridge.js';
import { attachClientHandler } from './ws/client.js';
import { healthzHandler } from './http/healthz.js';
import { registry } from './state.js';

export interface RelayHandle {
    server: http.Server;
    stop: () => Promise<void>;
}

export function createRelay(): RelayHandle {
    const server = http.createServer((req, res) => {
        if (req.url === '/healthz') return healthzHandler(req, res);
        res.writeHead(404).end();
    });

    const bridgeWss = new WebSocketServer({ noServer: true });
    const clientWss = new WebSocketServer({ noServer: true });

    bridgeWss.on('connection', (ws) => attachBridgeHandler(ws));
    clientWss.on('connection', (ws) => attachClientHandler(ws));

    server.on('upgrade', (req, socket, head) => {
        if (req.url === '/bridge') {
            bridgeWss.handleUpgrade(req, socket, head, (ws) => bridgeWss.emit('connection', ws, req));
        } else if (req.url === '/client') {
            clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
        } else {
            socket.destroy();
        }
    });

    const sweep = setInterval(() => {
        registry.sweepExpired(Math.floor(Date.now() / 1000));
    }, config.sweepIntervalMs);
    sweep.unref();

    const heartbeat = setInterval(() => {
        for (const wss of [bridgeWss, clientWss]) {
            for (const ws of wss.clients) {
                try { ws.ping(); } catch {}
            }
        }
    }, config.pingIntervalMs);
    heartbeat.unref();

    async function stop(): Promise<void> {
        clearInterval(sweep);
        clearInterval(heartbeat);
        for (const wss of [bridgeWss, clientWss]) {
            for (const ws of wss.clients) {
                try { ws.send(JSON.stringify({ type: 'relay_draining' })); } catch {}
                try { ws.close(1001, 'draining'); } catch {}
            }
            wss.close();
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    return { server, stop };
}

export function startRelay(): RelayHandle {
    const handle = createRelay();
    handle.server.listen(config.port, () => {
        log.info({ port: config.port, env: config.nodeEnv }, 'relay listening');
    });
    return handle;
}
