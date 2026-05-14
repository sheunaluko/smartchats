import type { Logger, RunOutcome } from '../types.js';

const SUPPORTS_COLOR =
    !('NO_COLOR' in process.env) && (process.stderr.isTTY ?? false);

const C = SUPPORTS_COLOR
    ? {
          red: '\x1b[0;31m',
          green: '\x1b[0;32m',
          yellow: '\x1b[0;33m',
          blue: '\x1b[0;34m',
          gray: '\x1b[0;90m',
          bold: '\x1b[1m',
          reset: '\x1b[0m',
      }
    : {
          red: '',
          green: '',
          yellow: '',
          blue: '',
          gray: '',
          bold: '',
          reset: '',
      };

export const consoleLogger: Logger = {
    info(msg: string): void {
        process.stderr.write(`${C.blue}[info]${C.reset} ${msg}\n`);
    },
    ok(msg: string): void {
        process.stderr.write(`${C.green}[ok]${C.reset} ${msg}\n`);
    },
    warn(msg: string): void {
        process.stderr.write(`${C.yellow}[warn]${C.reset} ${msg}\n`);
    },
    err(msg: string): void {
        process.stderr.write(`${C.red}[err]${C.reset} ${msg}\n`);
    },
    header(msg: string): void {
        process.stderr.write(`\n${C.bold}==> ${msg}${C.reset}\n`);
    },
};

/** Render the summary table at the end of a run. */
export function printSummary(outcome: RunOutcome): void {
    process.stderr.write(`\n${C.bold}smartchats-test summary${C.reset}\n`);
    process.stderr.write(`  L#  ${'LEVEL'.padEnd(14)}  ${'STATUS'.padEnd(7)}  TIME   NOTE\n`);
    process.stderr.write(
        `  ${'─'.repeat(3)}  ${'─'.repeat(14)}  ${'─'.repeat(7)}  ${'─'.repeat(5)}  ────\n`,
    );
    for (const o of outcome.levels) {
        const statusColor =
            o.result.status === 'PASS'
                ? C.green
                : o.result.status === 'FAIL'
                ? C.red
                : C.gray;
        const sec = (o.duration_ms / 1000).toFixed(1);
        process.stderr.write(
            `  L${String(o.level.id).padEnd(2)}  ${o.level.name.padEnd(14)}  ` +
                `${statusColor}${o.result.status.padEnd(7)}${C.reset}  ${sec.padStart(5)}s ${
                    o.result.note ?? ''
                }\n`,
        );
    }
    const totalSec = (outcome.duration_ms / 1000).toFixed(1);
    process.stderr.write(`  ${' '.repeat(3)}  ${'TOTAL'.padEnd(14)}  ${' '.repeat(7)}  ${totalSec.padStart(5)}s\n`);
    process.stderr.write('\n');
    if (outcome.passed) {
        process.stderr.write(`${C.green}smartchats-test PASS ✓${C.reset}\n`);
    } else {
        process.stderr.write(`${C.red}smartchats-test FAIL ✗${C.reset}\n`);
    }
}
