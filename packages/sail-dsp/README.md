sail-dsp
========

Rust→WASM audio DSP primitives for the SmartChats Audio Intelligence Lab (/sail).
Phase 1 POC: `add`, `rms`, `version` — enough to confirm the toolchain works
end-to-end. Will grow into the analyzer toolkit (FFT, mel-spectrogram,
envelope follower, etc.) as /sail matures.

Why rust + wasm? Audio DSP that runs per-frame benefits from compiled
performance and predictable allocation. ONNX Runtime already gives us
neural inference; this crate is for the custom-DSP layer alongside it.

## Iterating on this crate

Most developers don't need rust installed — the compiled wasm artifact
in `pkg/` is committed to git and consumed transparently by
`apps/smartchats` via the npm workspace symlink.

If you want to modify the rust code:

```bash
# one-time install (macOS)
brew install rust wasm-pack
rustup target add wasm32-unknown-unknown

# rebuild after editing src/*.rs
cd packages/sail-dsp
wasm-pack build --target web --release

# stage the new pkg/ output (it's checked in)
git add pkg/
```

## Layout

```
Cargo.toml         crate manifest (cdylib + rlib, opt-level=z for small wasm)
src/lib.rs         the rust exports — all #[wasm_bindgen] attributed
pkg/               wasm-pack output, COMMITTED to git
  sail_dsp.js          JS glue (the loader + bindings)
  sail_dsp_bg.wasm     the actual binary
  sail_dsp.d.ts        TypeScript types
  package.json         auto-generated workspace package manifest
```

The consumer side in `apps/smartchats/package.json` references this
package as a workspace dep (`"sail-dsp": "*"`), so updates to `pkg/`
flow through automatically after `npm install`.

## Versioning

The `version()` export returns a string baked into the binary. Bump it
when the crate's behavior changes — /sail's Lab POC panel surfaces it
so a stale-cache mismatch is immediately visible.
