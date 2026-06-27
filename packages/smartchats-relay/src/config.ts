function numEnv(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
    return n;
}

export const config = {
    port: numEnv('PORT', 8080),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    devTokenBypass: process.env.DEV_TOKEN_BYPASS === 'true',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    firebaseCredentials: process.env.FIREBASE_CREDENTIALS,
    maxBridgesPerUser: numEnv('MAX_BRIDGES_PER_USER', 10),
    maxClientsPerUser: numEnv('MAX_CLIENTS_PER_USER', 20),
    pingIntervalMs: numEnv('PING_INTERVAL_MS', 30_000),
    pingTimeoutMs: numEnv('PING_TIMEOUT_MS', 60_000),
    helloTimeoutMs: numEnv('HELLO_TIMEOUT_MS', 5_000),
    sweepIntervalMs: numEnv('SWEEP_INTERVAL_MS', 30_000),
};

if (config.nodeEnv === 'production' && config.devTokenBypass) {
    throw new Error('DEV_TOKEN_BYPASS must not be true when NODE_ENV=production');
}
if (config.nodeEnv === 'production' && !config.firebaseProjectId && !config.devTokenBypass) {
    throw new Error('FIREBASE_PROJECT_ID is required in production');
}
