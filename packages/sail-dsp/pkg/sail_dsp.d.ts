/* tslint:disable */
/* eslint-disable */

/**
 * Canonical smoke-test: integer add. Used by /sail's Lab POC panel to
 * confirm the wasm module loaded + exported functions are callable.
 */
export function add(a: number, b: number): number;

/**
 * Root-mean-square of an audio sample buffer. Standard amplitude
 * summary — used as the foundation for envelope followers, level
 * meters, and silence detection. Operates on the Float32Array directly
 * (no copy) thanks to wasm-bindgen's slice handling.
 *
 * Returns 0.0 for an empty buffer rather than NaN.
 */
export function rms(samples: Float32Array): number;

/**
 * Build identifier — useful for confirming a fresh wasm artifact is
 * loaded vs a stale cached one. Bumped by hand when the crate's
 * behavior changes meaningfully.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly add: (a: number, b: number) => number;
    readonly rms: (a: number, b: number) => number;
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
