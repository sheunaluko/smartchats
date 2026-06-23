#!/usr/bin/env -S npx tsx
/**
 * voicebench CLI — runs one or more scenarios × providers and reports.
 *
 * Usage:
 *   npm run bench -- [options]
 *
 * Options:
 *   --providers <names>     Comma-separated. Default: openai
 *   --scenarios <names>     Comma-separated. Default: short
 *   --voice <name>          Voice id (provider-specific). Default: first listed.
 *   --trials <n>            Trials per (provider, scenario). Default: 3.
 *   --inter-trial-ms <n>    Delay between trials. Default: 500.
 *   --out <path>            Write trial JSON to disk (in addition to console report).
 *   -h, --help
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import {
    OpenAITtsProvider, SCENARIOS, listScenarios,
    runScenario, reportTrials, reportAggregate,
    type TtsProvider, type TrialMeasurement,
} from '../src/index.js';

interface CliArgs {
    providers: string[];
    scenarios: string[];
    voice: string | null;
    trials: number;
    interTrialMs: number;
    out: string | null;
}

function parseArgs(argv: string[]): CliArgs | null {
    const a: CliArgs = {
        providers: ['openai'],
        scenarios: ['short'],
        voice: null,
        trials: 3,
        interTrialMs: 500,
        out: null,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]!;
        const next = () => argv[++i]!;
        switch (arg) {
            case '--providers':       a.providers = next().split(',').filter(Boolean); break;
            case '--scenarios':       a.scenarios = next().split(',').filter(Boolean); break;
            case '--voice':           a.voice = next(); break;
            case '--trials':          a.trials = Math.max(1, parseInt(next(), 10) || 3); break;
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

function buildProvider(name: string): TtsProvider {
    switch (name) {
        case 'openai': return new OpenAITtsProvider();
        // xai / gcp_streaming / gemini_live will land in subsequent commits
        default:
            throw new Error(`Unknown provider: ${name}. Available today: openai`);
    }
}

const args = parseArgs(process.argv);
if (!args) {
    console.error('Usage: npm run bench -- [--providers <names>] [--scenarios <names>] [--voice <name>] [--trials <n>] [--inter-trial-ms <n>] [--out <path>]');
    console.error(`Scenarios available: ${listScenarios().join(', ')}`);
    process.exit(1);
}

console.error(`voicebench: providers=${args.providers.join(',')}  scenarios=${args.scenarios.join(',')}  trials=${args.trials}`);

const allTrials: TrialMeasurement[] = [];

for (const providerName of args.providers) {
    let provider: TtsProvider;
    try {
        provider = buildProvider(providerName);
    } catch (err) {
        console.error(`Skipping ${providerName}: ${(err as Error).message}`);
        continue;
    }
    const voice = args.voice ?? provider.listVoices()[0]!;

    for (const scenarioId of args.scenarios) {
        const scenario = SCENARIOS[scenarioId];
        if (!scenario) {
            console.error(`Skipping unknown scenario: ${scenarioId} (available: ${listScenarios().join(', ')})`);
            continue;
        }
        console.error(`  running ${providerName} × ${scenarioId} (voice=${voice}, ${args.trials} trials)...`);
        const trials = await runScenario({
            provider, scenario, voice, trials: args.trials,
            interTrialMs: args.interTrialMs,
        });
        allTrials.push(...trials);
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
