import { startRelay } from './server.js';
import { log } from './lib/log.js';

const handle = startRelay();

function shutdown(signal: string) {
    log.info({ signal }, 'shutdown');
    handle.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
