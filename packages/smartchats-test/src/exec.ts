/**
 * Subprocess helper — spawn a command, stream stdout/stderr, resolve with
 * exit code. Keeps the runner pure-async and avoids `child_process.exec`'s
 * buffering footgun.
 */

import { spawn } from 'node:child_process';

export interface RunOpts {
    /** Working directory. Defaults to process.cwd(). */
    cwd?: string;
    /** Env vars to merge over process.env. */
    env?: Record<string, string>;
    /**
     * If true, route subprocess stdout/stderr to the parent's stdout/stderr.
     * If false, capture quietly and return in the result. Default: true.
     */
    inherit?: boolean;
}

export interface RunResult {
    code: number;
    /** Captured output (empty when inherit=true). */
    stdout: string;
    stderr: string;
}

export function runCmd(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: { ...process.env, ...opts.env },
            stdio: opts.inherit === false ? 'pipe' : 'inherit',
        });

        let stdout = '';
        let stderr = '';
        if (opts.inherit === false) {
            child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        }

        child.on('close', (code: number | null) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });
        child.on('error', (err: Error) => {
            resolve({ code: 1, stdout, stderr: stderr + (err.message ?? String(err)) });
        });
    });
}
