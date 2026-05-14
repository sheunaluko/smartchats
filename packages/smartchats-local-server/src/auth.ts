import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from './config.js';

/**
 * Bearer-token middleware. No-op when `config.apiKey` is null (trusted local mode).
 * Otherwise requires `Authorization: Bearer <apiKey>` and returns 401 if missing/wrong.
 *
 * Designed as a single shared-secret check — self-hosted mode is inherently single-user,
 * no need for per-user accounts or JWT rotation.
 */
export function makeAuthMiddleware(config: ServerConfig) {
    const expected = config.apiKey;
    return function auth(req: Request, res: Response, next: NextFunction) {
        if (!expected) return next();
        const header = req.header('authorization') ?? '';
        const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
        if (token !== expected) {
            return res.status(401).json({ error: 'unauthorized' });
        }
        next();
    };
}
