/**
 * Express app factory.
 *
 * Two surfaces, mounted on the same Express app:
 *   1. API at `/local-api/*` — what the browser calls. Mounted under that
 *      prefix so URLs match in BOTH paths: production (this server serves
 *      both API and SPA) and dev (Next.js dev forwards /local-api/* here
 *      via rewrite, preserving the prefix).
 *   2. Static SPA at `/` (enabled when SMARTCHATS_STATIC_DIR is set) —
 *      points at the `apps/smartchats/out/` static export, plus the four
 *      site-page rewrites that Next's standalone server would do via
 *      next.config.mjs rewrites (those don't apply in static export).
 *
 * In dev mode, leave SMARTCHATS_STATIC_DIR unset and let Next.js dev serve
 * the UI on its own port; this server stays API-only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { ServerConfig } from './config.js';
import { makeAuthMiddleware } from './auth.js';
import { dataRoutes } from './routes/data.js';
import { keysRoutes } from './routes/keys.js';
import { embeddingsRoutes } from './routes/embeddings.js';
import { usageRoutes } from './routes/usage.js';
import { insightsRoutes } from './routes/insights.js';
import { toolsRoutes } from './routes/tools.js';
import { ttsRoutes } from './routes/tts.js';
import { llmRoutes } from './routes/llm.js';
import { healthRoutes } from './routes/health.js';
import { log } from './logger.js';

const reqLog = log.withTag('req');

function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        const line = `${req.method} ${req.originalUrl} → ${res.statusCode} ${ms}ms`;
        if (res.statusCode >= 500) reqLog.error(line);
        else if (res.statusCode >= 400) reqLog.warn(line);
        else reqLog.info(line);
    });
    next();
}

function mountApi(config: ServerConfig): express.Router {
    const api = express.Router();
    api.use(makeAuthMiddleware(config));
    api.use('/health', healthRoutes(config));
    api.use('/llm', llmRoutes(config));
    api.use('/tts', ttsRoutes(config));
    api.use('/embeddings', embeddingsRoutes(config));
    api.use('/data', dataRoutes());
    api.use('/usage', usageRoutes());
    api.use('/keys', keysRoutes(config));
    api.use('/tools', toolsRoutes(config));
    api.use('/insights', insightsRoutes());
    return api;
}

function mountStaticSpa(app: Express, staticDir: string): void {
    // Site-page rewrites — match what next.config.mjs's `rewrites()` block
    // would do in standalone mode. Static export doesn't honor rewrites, so
    // we replicate them here.
    const siteRewrites: Record<string, string> = {
        '/': '_site/index.html',
        '/docs': '_site/docs/index.html',
        '/privacy-policy': '_site/privacy-policy/index.html',
        '/terms-of-service': '_site/terms-of-service/index.html',
    };
    for (const [route, file] of Object.entries(siteRewrites)) {
        app.get(route, (_req, res) => res.sendFile(path.join(staticDir, file)));
    }
    app.get('/docs/:slug', (req, res) => {
        res.sendFile(path.join(staticDir, '_site/docs', req.params.slug, 'index.html'));
    });

    // App pages: /app → app.html, /sail → sail.html, etc. via the `extensions`
    // option (Next export emits flat `<route>.html` files at the static root).
    app.use(express.static(staticDir, { extensions: ['html'] }));

    // Fallback for paths express.static didn't match:
    //   - Asset-looking URLs (extension in ASSET_EXTS) → real 404. Returning
    //     HTML here would break: the browser parses the response as JS/CSS/etc.
    //     and a parse failure on a webpack chunk triggers Next.js's recovery
    //     hard-refresh → infinite reload loop.
    //   - Anything else → serve 404.html (Next's SPA 404 shell). Client-side
    //     routing inside the loaded bundle handles the actual route.
    const ASSET_EXTS = /\.(js|mjs|css|map|json|wasm|onnx|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico|txt|xml|webmanifest)$/i;
    app.get('*', (req, res) => {
        if (ASSET_EXTS.test(req.path)) {
            res.status(404).type('text/plain').send('Not Found');
            return;
        }
        res.sendFile(path.join(staticDir, '404.html'));
    });
}

export function createApp(config: ServerConfig): Express {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(requestLogger);

    app.use('/local-api', mountApi(config));

    const staticDir = process.env.SMARTCHATS_STATIC_DIR;
    if (staticDir && fs.existsSync(staticDir)) {
        mountStaticSpa(app, staticDir);
        log.info(`serving SPA from ${staticDir}`);
    }

    return app;
}
