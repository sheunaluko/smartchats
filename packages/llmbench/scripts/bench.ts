#!/usr/bin/env -S npx tsx
/**
 * llmbench CLI — benchmark LLM models across providers + tiers.
 *
 * Usage:
 *   npm run bench -- [options]
 *
 * Common patterns:
 *   --tiers top,mid,cheap                # bench all tiered models across providers
 *   --models gpt-5.5,claude-opus-4-7     # bench specific model keys
 *   --providers openai,anthropic         # restrict to subset of providers
 *
 * Scenario + trial controls:
 *   --scenarios snappy_qa,conversation
 *   --cold-trials 1
 *   --warm-trials 4
 *   --out results/run_<ts>.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { listTieredModels, type ModelTier, type Provider } from 'cortex';
import {
    SCENARIOS, listScenarios,
    runScenario, reportTrials, reportAggregate,
    type TrialMeasurement,
} from '../src/index.js';

interface CliArgs {
    tiers: ModelTier[];
    models: string[];        // explicit model keys (override tiers)
    providers: Provider[];   // restrict tier-resolved models to these providers
    scenarios: string[];
    coldTrials: number;
    warmTrials: number;
    interTrialMs: number;
    out: string | null;
}

function parseArgs(argv: string[]): CliArgs | null {
    const a: CliArgs = {
        tiers: [],
        models: [],
        providers: [],
        scenarios: ['snappy_qa'],
        coldTrials: 1,
        warmTrials: 4,
        interTrialMs: 500,
        out: null,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]!;
        const next = () => argv[++i]!;
        switch (arg) {
            case '--tiers':           a.tiers = next().split(',').filter(Boolean) as ModelTier[]; break;
            case '--models':          a.models = next().split(',').filter(Boolean); break;
            case '--providers':       a.providers = next().split(',').filter(Boolean) as Provider[]; break;
            case '--scenarios':       a.scenarios = next().split(',').filter(Boolean); break;
            case '--cold-trials':     a.coldTrials = Math.max(0, parseInt(next(), 10) || 0); break;
            case '--warm-trials':     a.warmTrials = Math.max(0, parseInt(next(), 10) || 0); break;
            case '--inter-trial-ms':  a.interTrialMs = Math.max(0, parseInt(next(), 10) || 500); break;
            case '--out':             a.out = next(); break;
            case '-h':
            case '--help':            return null;
            default:
                console.error(`unknown arg: ${arg}`);
                return null;
        }
    }
    return a;
}

function resolveModels(args: CliArgs): string[] {
    if (args.models.length > 0) return args.models;
    if (args.tiers.length === 0) {
        // Default: all tiered models across all providers
        return listTieredModels().map((m) => m.key);
    }
    let all = listTieredModels().filter((m) => args.tiers.includes(m.tier));
    if (args.providers.length > 0) {
        all = all.filter((m) => args.providers.includes(m.provider));
    }
    return all.map((m) => m.key);
}

const args = parseArgs(process.argv);
if (!args) {
    console.error('Usage: npm run bench -- [--tiers top,mid,cheap] [--models key,key] [--providers openai,...] [--scenarios snappy_qa,conversation] [--cold-trials 1] [--warm-trials 4] [--out path.json]');
    console.error(`Scenarios available: ${listScenarios().join(', ')}`);
    process.exit(1);
}

const modelKeys = resolveModels(args);
console.error(`llmbench: ${modelKeys.length} model(s) × ${args.scenarios.length} scenario(s) × (cold=${args.coldTrials} + warm=${args.warmTrials}) trials`);
console.error(`  models: ${modelKeys.join(', ')}`);
console.error(`  scenarios: ${args.scenarios.join(', ')}`);

// Unhandled-rejection guard: some provider SDKs reject futures from a
// detached background task that the per-trial try/catch can't reach in
// time. We want to log the failure and keep going — not crash the whole
// 100-trial run because one model errored out.
process.on('unhandledRejection', (reason) => {
    console.error(`  [unhandledRejection] ${reason instanceof Error ? reason.message : String(reason)}`);
});

const allTrials: TrialMeasurement[] = [];

for (const modelKey of modelKeys) {
    for (const scenarioId of args.scenarios) {
        const scenario = SCENARIOS[scenarioId];
        if (!scenario) {
            console.error(`  skip unknown scenario: ${scenarioId}`);
            continue;
        }
        console.error(`  ${modelKey} × ${scenarioId}...`);
        try {
            const trials = await runScenario({
                modelKey, scenario,
                coldTrials: args.coldTrials,
                warmTrials: args.warmTrials,
                interTrialMs: args.interTrialMs,
            });
            allTrials.push(...trials);
        } catch (err) {
            console.error(`    FAILED: ${(err as Error).message}`);
        }
    }
}

console.log(reportTrials(allTrials));
console.log(reportAggregate(allTrials));

if (args.out) {
    const outPath = path.resolve(args.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
        runAt: new Date().toISOString(),
        args,
        trials: allTrials,
    }, null, 2));
    console.error(`Wrote ${allTrials.length} trials → ${outPath}`);
}
