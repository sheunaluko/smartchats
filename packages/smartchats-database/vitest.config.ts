import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Real-cloud integration tests run sequentially to avoid hammering
        // the cloud function with parallel calls during dev.
        fileParallelism: false,
        // 30s default — Firebase auth + cloud function round-trips can be
        // slow on cold starts.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
