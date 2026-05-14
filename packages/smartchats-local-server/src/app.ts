/**
 * Express app factory. Registers all routes but each handler is currently
 * a 501 Not Implemented stub — fill in per-concern in Phase 3 iterations.
 */

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

export function createApp(config: ServerConfig): Express {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(requestLogger);
    app.use(makeAuthMiddleware(config));

    // Health — aggregate readiness probe (data + providers + TTS key)
    app.use('/health', healthRoutes(config));

    // LLM
    app.use('/llm', llmRoutes(config));

    // TTS
    app.use('/tts', ttsRoutes(config));

    // Embeddings
    app.use('/embeddings', embeddingsRoutes(config));

    // Data (SurrealDB)
    app.use('/data', dataRoutes());

    // Usage
    app.use('/usage', usageRoutes());

    // Keys (BYO)
    app.use('/keys', keysRoutes(config));

    // Tools
    app.use('/tools', toolsRoutes(config));

    // Insights
    app.use('/insights', insightsRoutes());

    return app;
}
