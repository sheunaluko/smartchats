/**
 * CLI visual polish — logo banner + traveling sin-wave indicator.
 *
 * Used by `setup` (logo on first-run intro) and by `start` / wait helpers
 * (sin wave during readiness polls + builds). Zero deps — keeps the binary
 * size honest and respects NO_COLOR / non-TTY environments.
 */

// ─── Color helpers ────────────────────────────────────────────────────

const useColor = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

const RESET = '\x1b[0m';

/** 256-color foreground. `c` is 0-255. */
function fg(c: number, s: string): string {
    return useColor ? `\x1b[38;5;${c}m${s}${RESET}` : s;
}

function dim(s: string): string {
    return useColor ? `\x1b[2m${s}${RESET}` : s;
}

// Cyan → teal → green sweep, evocative of voice / waves / motion.
// Used by the traveling sin wave indicator.
const WAVE_COLORS = [39, 38, 44, 43, 49, 48, 84, 83, 119, 118, 154, 148, 184, 178];

// Solid vivid terminal green for the logo. ANSI 256: 46 ('lime' / classic
// CRT green). One color rather than a gradient keeps the large multi-line
// banner unified instead of busy.
const LOGO_COLOR = 46;

// ─── Logo ─────────────────────────────────────────────────────────────

// Mirrors data/ascii-art.txt. The art file is the canonical source — if
// either changes, update both. Inlined here (rather than read from disk
// at runtime) so the bun-compiled binary stays self-contained: no fs
// lookups, no __dirname path baking.
const LOGO_LINES = [
    String.raw`_____/\\\\\\\\\\\____/\\\\____________/\\\\_____/\\\\\\\\\_______/\\\\\\\\\______/\\\\\\\\\\\\\\\________/\\\\\\\\\__/\\\________/\\\_____/\\\\\\\\\_____/\\\\\\\\\\\\\\\_____/\\\\\\\\\\\___`,
    String.raw` ___/\\\/////////\\\_\/\\\\\\________/\\\\\\___/\\\\\\\\\\\\\___/\\\///////\\\___\///////\\\/////______/\\\////////__\/\\\_______\/\\\___/\\\\\\\\\\\\\__\///////\\\/////____/\\\/////////\\\_`,
    String.raw`  __\//\\\______\///__\/\\\//\\\____/\\\//\\\__/\\\/////////\\\_\/\\\_____\/\\\_________\/\\\_________/\\\/___________\/\\\_______\/\\\__/\\\/////////\\\_______\/\\\________\//\\\______\///__`,
    String.raw`   ___\////\\\_________\/\\\\///\\\/\\\/_\/\\\_\/\\\_______\/\\\_\/\\\\\\\\\\\/__________\/\\\________/\\\_____________\/\\\\\\\\\\\\\\\_\/\\\_______\/\\\_______\/\\\_________\////\\\_________`,
    String.raw`    ______\////\\\______\/\\\__\///\\\/___\/\\\_\/\\\\\\\\\\\\\\\_\/\\\//////\\\__________\/\\\_______\/\\\_____________\/\\\/////////\\\_\/\\\\\\\\\\\\\\\_______\/\\\____________\////\\\______`,
    String.raw`     _________\////\\\___\/\\\____\///_____\/\\\_\/\\\/////////\\\_\/\\\____\//\\\_________\/\\\_______\//\\\____________\/\\\_______\/\\\_\/\\\/////////\\\_______\/\\\_______________\////\\\___`,
    String.raw`      __/\\\______\//\\\__\/\\\_____________\/\\\_\/\\\_______\/\\\_\/\\\_____\//\\\________\/\\\________\///\\\__________\/\\\_______\/\\\_\/\\\_______\/\\\_______\/\\\________/\\\______\//\\\__`,
    String.raw`       _\///\\\\\\\\\\\/___\/\\\_____________\/\\\_\/\\\_______\/\\\_\/\\\______\//\\\_______\/\\\__________\////\\\\\\\\\_\/\\\_______\/\\\_\/\\\_______\/\\\_______\/\\\_______\///\\\\\\\\\\\/___`,
    String.raw`        ___\///////////_____\///______________\///__\///________\///__\///________\///________\///______________\/////////__\///________\///__\///________\///________\///__________\///////////_____`,
];

/**
 * Print the SmartChats logo in solid green. Single-shot — call once per
 * command run (typically at the top of `setup`).
 */
export function printLogo(): void {
    if (!useColor) {
        // Plain logo for non-TTY / NO_COLOR: still recognizable, no escapes.
        for (const line of LOGO_LINES) console.log(line);
        console.log('');
        return;
    }
    for (const line of LOGO_LINES) {
        console.log(fg(LOGO_COLOR, line));
    }
    console.log('');
}

// ─── Traveling sin wave ───────────────────────────────────────────────

const WAVE_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

interface WaveFrame {
    glyphs: string[];
    peakIndex: number;
}

function renderFrame(width: number, phase: number): WaveFrame {
    const glyphs: string[] = new Array(width);
    let peakIndex = 0;
    let peakValue = -Infinity;
    for (let x = 0; x < width; x++) {
        // Period ~16 chars; amplitude maps 0..1 → glyph index 0..7.
        const sine = (Math.sin((x - phase) * (Math.PI * 2) / 16) + 1) / 2;
        const idx = Math.min(WAVE_GLYPHS.length - 1, Math.floor(sine * WAVE_GLYPHS.length));
        glyphs[x] = WAVE_GLYPHS[idx]!;
        if (sine > peakValue) { peakValue = sine; peakIndex = x; }
    }
    return { glyphs, peakIndex };
}

function colorizeFrame(frame: WaveFrame): string {
    if (!useColor) return frame.glyphs.join('');
    let out = '';
    const width = frame.glyphs.length;
    for (let x = 0; x < width; x++) {
        // Color follows the wave — peak is brightest, dimmer at the edges.
        const distFromPeak = Math.min(
            Math.abs(x - frame.peakIndex),
            width - Math.abs(x - frame.peakIndex), // wrap-around
        );
        const t = Math.max(0, 1 - distFromPeak / (width / 4));
        const idx = Math.floor(t * (WAVE_COLORS.length - 1));
        out += fg(WAVE_COLORS[idx]!, frame.glyphs[x]!);
    }
    return out;
}

const WAVE_WIDTH = 32;
const WAVE_TICK_MS = 80;
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Run a sin wave indicator under `label` for the duration of `task`. The
 * wave moves left → right at ~12 Hz. Restores cursor on success, error, or
 * Ctrl-C. No-op on non-TTY: just runs `task` directly.
 *
 * Example:
 *   await withWave('Waiting for surreal', () => waitForUrl(...));
 */
export async function withWave<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (!process.stdout.isTTY || process.env.NO_COLOR) {
        return task();
    }

    let phase = 0;
    const stream = process.stdout;
    stream.write(HIDE_CURSOR);

    const render = () => {
        const frame = renderFrame(WAVE_WIDTH, phase);
        // Carriage return + clear line + label + wave. No newline.
        stream.write(`\r\x1b[K${dim(label)}  ${colorizeFrame(frame)}`);
        phase += 1;
    };

    render();
    const timer = setInterval(render, WAVE_TICK_MS);

    const cleanup = () => {
        clearInterval(timer);
        stream.write(`\r\x1b[K${SHOW_CURSOR}`);
    };

    // Don't lose the cursor if the user Ctrl-Cs during a wave.
    const onSigint = () => { cleanup(); process.exit(130); };
    process.once('SIGINT', onSigint);

    try {
        const result = await task();
        cleanup();
        process.removeListener('SIGINT', onSigint);
        return result;
    } catch (err) {
        cleanup();
        process.removeListener('SIGINT', onSigint);
        throw err;
    }
}
