import pino from 'pino';
import { config } from '../config.js';

export const log = pino({
    level: config.logLevel,
    redact: { paths: ['token', '*.token', '*.*.token'], remove: true },
    transport: config.nodeEnv !== 'production' ? { target: 'pino-pretty' } : undefined,
});
