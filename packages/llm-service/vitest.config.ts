import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Unit tests live next to the source files they cover (foo.test.ts
        // next to foo.ts). No network, no real LLM/TTS — see each test
        // file's preamble for the test-double pattern.
        include: ['src/**/*.test.ts'],
        // Short timeout — anything past 2s indicates a hung async iterator
        // or unresolved promise, not real work.
        testTimeout: 2_000,
    },
});
